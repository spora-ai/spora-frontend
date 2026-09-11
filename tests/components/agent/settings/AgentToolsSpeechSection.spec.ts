/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Mounts the section against a mock store + useToolSettings bridge.
 * Covers: empty state, cascade-source badge (agent override > user >
 * group > global > not configured), create flow via the inherited form,
 * edit flow, and remove flow.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const ensureMock = vi.fn()
const loadForGroupMock = vi.fn()
const upsertMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const storeProviders = ref<Array<Record<string, unknown>>>([])
const storePersonal = ref<Array<Record<string, unknown>>>([])
const storeGlobal = ref<Array<Record<string, unknown>>>([])
const storeGroup = ref<Array<Record<string, unknown>>>([])
const storeError = ref<string | null>(null)

const storeMock = reactive({
  providers: storeProviders,
  personalConfigs: storePersonal,
  globalConfigs: storeGlobal,
  groupConfigs: storeGroup,
  error: storeError,
  ensure: ensureMock,
  loadForGroup: loadForGroupMock,
  providerByClass: (cls: string) => storeProviders.value.find((p) => p.class === cls),
  upsert: upsertMock,
  update: updateMock,
  remove: removeMock,
})

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
    }
  },
}))

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => storeMock,
}))

const agentGetSettingsMock = vi.fn()
const agentPutSettingsMock = vi.fn()
const agentDeleteSettingsMock = vi.fn()
const agentGetRawOverrideMock = vi.fn()

vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => ({
    getSettings: agentGetSettingsMock,
    putSettings: agentPutSettingsMock,
    deleteSettings: agentDeleteSettingsMock,
    getRawOverride: agentGetRawOverrideMock,
    getSettingsWithSource: vi.fn(),
    getUserSettings: vi.fn(),
    putUserSettings: vi.fn(),
    getGlobalSettings: vi.fn(),
    deleteUserSettings: vi.fn(),
    getToolStatus: vi.fn(),
    getAllToolStatuses: vi.fn(),
  }),
}))

import AgentToolsSpeechSection from '@/components/agent/settings/AgentToolsSpeechSection.vue'
import SpeechProviderConfigForm from '@/components/settings/speech/SpeechProviderConfigForm.vue'

const OPENAI_CLASS = 'Spora\\Speech\\OpenAiCompatibleTranscriber'

const openAiProvider = {
  class: OPENAI_CLASS,
  display_name: 'OpenAI Compatible',
  settings_schema: [
    { key: 'display_name', label: 'Display name', type: 'text', required: true },
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true, default: 'whisper-1' },
    { key: 'base_url', label: 'Base URL', type: 'text', required: true, default: 'https://api.openai.com/v1' },
  ],
}

const FormStub = {
  name: 'SpeechProviderConfigForm',
  props: ['provider', 'config', 'scope', 'groupId', 'agentId', 'saving'],
  emits: ['saved', 'deleted', 'cancel'],
  template: '<div class="form-stub" :data-scope="scope" :data-agent-id="agentId" :data-provider-class="provider.class"></div>',
}

function mountSection(props: Record<string, unknown> = {}) {
  return mount(AgentToolsSpeechSection, {
    props: {
      agent: { id: 1, principal_id: 10, group_id: null, tools: [] },
      agentId: 1,
      ...props,
    },
    global: { stubs: { SpeechProviderConfigForm: FormStub, Icon: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  ensureMock.mockResolvedValue(undefined)
  loadForGroupMock.mockResolvedValue([])
  storeProviders.value = [openAiProvider]
  storePersonal.value = []
  storeGlobal.value = []
  storeGroup.value = []
  storeError.value = null
  agentGetSettingsMock.mockResolvedValue({})
  agentPutSettingsMock.mockResolvedValue({})
  agentDeleteSettingsMock.mockResolvedValue(undefined)
  upsertMock.mockResolvedValue({ id: 1 })
  updateMock.mockResolvedValue({ id: 1 })
  removeMock.mockResolvedValue({ deleted: true })
})

describe('AgentToolsSpeechSection', () => {
  it('renders the empty state CTA when no override exists', async () => {
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('[data-testid="agent-speech-create"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Set STT provider')
  })

  it('shows "agent override" badge when an override exists', async () => {
    agentGetSettingsMock.mockResolvedValueOnce({ display_name: 'Agent Mistral', api_key: 'sk' })
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Agent Mistral')
    expect(badge.text()).toContain('agent override')
  })

  it('falls back to user default when no agent override exists', async () => {
    storePersonal.value = [
      {
        id: 99,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'user',
        display_name: 'Personal Voxtral',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Personal Voxtral')
    expect(badge.text()).toContain('user default')
  })

  it('falls back to group default when no agent or user config', async () => {
    storeGroup.value = [
      {
        id: 50,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'group',
        display_name: 'Team Whisper',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection({ agent: { id: 1, principal_id: 10, group_id: 5, tools: [] } })
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Team Whisper')
    expect(badge.text()).toContain('group default')
    expect(loadForGroupMock).toHaveBeenCalledWith(5)
  })

  it('falls back to global default when no agent/user/group config', async () => {
    storeGlobal.value = [
      {
        id: 200,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'global',
        display_name: 'Org-wide Whisper',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('global default')
  })

  it('renders the "Not configured" badge when nothing is configured', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('No speech provider configured')
  })

  it('opens the form with scope=agent when CTA is clicked and a single provider is registered', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-testid="agent-speech-create"]').trigger('click')
    await flushPromises()
    const form = wrapper.findComponent(SpeechProviderConfigForm)
    expect(form.exists()).toBe(true)
    expect(form.props('scope')).toBe('agent')
    expect(form.props('agentId')).toBe(1)
    expect(form.props('provider').class).toBe(OPENAI_CLASS)
    expect(form.props('config')).toBeNull()
  })

  it('routes through the agent tool override endpoint on save', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-testid="agent-speech-create"]').trigger('click')
    await flushPromises()
    const form = wrapper.findComponent(SpeechProviderConfigForm)
    const envelope = {
      id: 0,
      provider_class: OPENAI_CLASS,
      provider_display_name: 'OpenAI Compatible',
      scope: 'agent',
      display_name: 'Personal Mistral',
      settings: { display_name: 'Personal Mistral', api_key: 'sk', model: 'voxtral-mini-latest', base_url: 'https://api.mistral.ai/v1' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    await form.vm.$emit('saved', envelope)
    await flushPromises()
    // After save the section returns to the idle view with the badge set
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Personal Mistral')
    expect(badge.text()).toContain('agent override')
  })

  it('removes the override when "Remove override" is clicked', async () => {
    agentGetSettingsMock.mockResolvedValueOnce({ display_name: 'Old', api_key: 'sk' })
    const wrapper = mountSection()
    await flushPromises()
    // Open edit form by selecting the existing row in the list view
    const editButton = wrapper.find('.w-full.flex.items-center.justify-between.px-5.py-4')
    expect(editButton.exists()).toBe(true)
    await editButton.trigger('click')
    await flushPromises()
    // Now the form stub is rendered alongside the remove button
    const removeBtn = wrapper.find('[data-testid="agent-speech-remove"]')
    expect(removeBtn.exists()).toBe(true)
    await removeBtn.trigger('click')
    await flushPromises()
    expect(agentDeleteSettingsMock).toHaveBeenCalledWith(OPENAI_CLASS)
    // After delete the override is gone, badge reverts to defaults
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('No speech provider configured')
  })

  it('surfaces an ApiError message inline when load fails', async () => {
    const { ApiError } = await import('@/api/client')
    agentGetSettingsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    const wrapper = mountSection()
    await flushPromises()
    const errorEl = wrapper.find('[data-testid="agent-speech-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('boom')
  })

  it('cancels out of the form back to idle', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-testid="agent-speech-create"]').trigger('click')
    await flushPromises()
    const form = wrapper.findComponent(SpeechProviderConfigForm)
    await form.vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.find('[data-testid="agent-speech-create"]').exists()).toBe(true)
  })
})
