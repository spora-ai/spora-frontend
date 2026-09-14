/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Mounts the section against a mock store + useToolSettings bridge.
 * Covers: empty state, cascade-source badge (agent override > user >
 * group > global > not configured), the new dropdown UX that picks an
 * existing speech config (user / group / global) to override the
 * cascade — mirroring AgentLlmSection's LLM-config select — and the
 * inline `+ New` create modal (mirrors AgentLlmConfigModal).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive, computed } from 'vue'
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

// The capability composable drives the cascade badge for tiers 2-5
// (user preference → group preference → global default → fallback).
// Each test seeds `capabilityEffective*` to control what the badge
// resolves to, since the old client-side chain was removed in favour of
// the backend's resolved cascade.
const capabilityEffectiveClass = ref<string | null>(null)
const capabilityEffectiveSource = ref<string | null>(null)
const capabilityRefreshMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/composables/useSpeechCapability', () => ({
  useSpeechCapability: () => ({
    state: ref({
      available: capabilityEffectiveClass.value !== null,
      configured: capabilityEffectiveClass.value !== null,
      providers: capabilityEffectiveClass.value === null
        ? []
        : [{
            name: capabilityEffectiveClass.value,
            display_name: capabilityEffectiveClass.value,
            configured: true,
            effective_class: capabilityEffectiveClass.value,
            effective_source: capabilityEffectiveSource.value,
          }],
    }),
    canRecord: computed(() => capabilityEffectiveClass.value !== null),
    effectiveClass: computed(() => capabilityEffectiveClass.value),
    effectiveSource: computed(() => capabilityEffectiveSource.value),
    loading: ref(false),
    error: ref<string | null>(null),
    refresh: capabilityRefreshMock,
  }),
}))

import AgentToolsSpeechSection from '@/components/agent/settings/AgentToolsSpeechSection.vue'

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

// Inline Modal stub — the real `Modal` uses `<Teleport to="body">`,
// which Vue Test Utils' `wrapper.find()` does NOT traverse. Rendering
// the slot inline keeps the assertion (`form is inside the modal`)
// reachable from the wrapper.
const InlineModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size'],
  emits: ['update:modelValue', 'close'],
  template: '<div v-if="modelValue" class="modal-stub"><slot /></div>',
}

function mountSection(
  props: Record<string, unknown> = {},
  extraStubs: Record<string, unknown> = {},
) {
  return mount(AgentToolsSpeechSection, {
    props: {
      agent: { id: 1, principal_id: 10, group_id: null, tools: [] },
      agentId: 1,
      ...props,
    },
    // `Icon` is a presentational wrapper; `Modal` is replaced with an
    // inline stub (see above); `SpeechProviderCreateForm` is stubbed by
    // default so tests that don't open the modal don't pay its
    // dependency cost. Tests that exercise the modal pass a customised
    // stub via `extraStubs`.
    global: {
      stubs: {
        Icon: true,
        Modal: InlineModalStub,
        SpeechProviderCreateForm: true,
        ...extraStubs,
      },
    },
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
  capabilityEffectiveClass.value = null
  capabilityEffectiveSource.value = null
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
    // Both the empty state CTA's "Set STT provider" button and the
    // dropdown row's "+ New" button share the data-testid. When nothing
    // is configured anywhere we expect the empty state path, which
    // surfaces "Set STT provider".
    expect(wrapper.find('[data-testid="agent-speech-create"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Set STT provider')
    // Dropdown is not rendered in the empty state path.
    expect(wrapper.find('[data-testid="agent-speech-config-select"]').exists()).toBe(false)
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
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'user_preference'
    storeProviders.value = [openAiProvider]
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
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'group_preference'
    storeProviders.value = [openAiProvider]
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
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
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

  it('dropdown lists user, group, and global configs sorted by scope', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    // Two global configs to verify display_name sort within a scope.
    // Personal Voxtral sorts last because user scope sorts after group.
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 201, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Global Mistral', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    storeGroup.value = [
      {
        id: 50, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'group', display_name: 'Team Whisper', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    storePersonal.value = [
      {
        id: 99, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'user', display_name: 'Personal Voxtral', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const select = wrapper.find('[data-testid="agent-speech-config-select"]')
    expect(select.exists()).toBe(true)
    const optionTexts = select.findAll('option').map((o) => o.text())
    expect(optionTexts[0]).toBe('— Use cascade default —')
    expect(optionTexts.slice(1)).toEqual([
      'Global Mistral (global)',
      'Org-wide Whisper (global)',
      'Team Whisper (group)',
      'Personal Voxtral (user)',
    ])
  })

  it('selecting a config writes the agent override with that config settings', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    const configSettings = {
      display_name: 'Org-wide Whisper',
      api_key: 'sk-global',
      model: 'whisper-1',
    }
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: configSettings,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    // Sanity: cascade default is in effect, no agent override yet.
    let badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('global default')
    expect(badge.text()).not.toContain('agent override')
    expect(agentPutSettingsMock).not.toHaveBeenCalled()

    // Pick the global config — should write the override. Using
    // setSelected on the option directly because Vue renders
    // `<option :value="200">` with that numeric value, but for the
    // `<option :value="null">` placeholder the DOM `value` attribute
    // collapses to the option's textContent — setValue with an empty
    // string would not select anything in that case. Using setSelected
    // uniformly keeps both branches symmetric.
    const options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option')
    const globalOption = options.find((o) => o.text().includes('Org-wide Whisper'))!
    await globalOption.setSelected()
    await flushPromises()

    expect(agentPutSettingsMock).toHaveBeenCalledWith(
      OPENAI_CLASS,
      configSettings,
      undefined,
    )
    badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('agent override')
  })

  it('selecting "Use cascade default" deletes the existing agent override', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper',
        settings: { display_name: 'Org-wide Whisper', api_key: 'sk-global' },
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    // Seed an agent override whose provider_class matches the global
    // config — the dropdown should pre-select id 200 on load.
    agentGetSettingsMock.mockResolvedValueOnce({ display_name: 'Agent Mistral', api_key: 'sk' })
    const wrapper = mountSection()
    await flushPromises()
    let badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Agent Mistral')
    expect(badge.text()).toContain('agent override')

    // Switch to "Use cascade default" — should delete the override.
    const options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option')
    const defaultOption = options.find((o) => o.text().includes('Use cascade default'))!
    await defaultOption.setSelected()
    await flushPromises()

    expect(agentDeleteSettingsMock).toHaveBeenCalledWith(OPENAI_CLASS)
    badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('global default')
    expect(badge.text()).not.toContain('agent override')
  })

  it('+ New button opens an inline create modal', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const newBtn = wrapper.find('[data-testid="agent-speech-create"]')
    expect(newBtn.exists()).toBe(true)
    expect(newBtn.text()).toContain('+ New')

    // Before clicking: modal is not in the DOM.
    expect(wrapper.find('.modal-stub').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).exists()).toBe(false)

    await newBtn.trigger('click')
    await flushPromises()

    // After clicking: the inline create modal mounts and renders
    // SpeechProviderCreateForm — the same shape as the LLM modal.
    expect(wrapper.find('.modal-stub').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).exists()).toBe(true)
  })

  it('+ New → created event auto-selects the new config', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const NEW_ID = 4242
    const newConfig = {
      id: NEW_ID,
      provider_class: OPENAI_CLASS,
      provider_display_name: 'OpenAI Compatible',
      scope: 'user',
      display_name: 'My Whisper',
      settings: { display_name: 'My Whisper', api_key: 'sk-new', model: 'whisper-1' },
      is_default: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const SpeechFormStub = {
      name: 'SpeechProviderCreateForm',
      props: ['scope', 'groupId'],
      emits: ['created', 'cancel'],
      setup() {
        function submit(): void {
          // Simulate the `store.upsert()` side effect: the real flow
          // refreshes the personal-configs list via `loadConfigs()`
          // before resolving, so the new config is in
          // `store.personalConfigs` by the time `created` fires. The
          // section's watcher relies on this so `persistConfigSelection`
          // can look the new id up in `availableConfigs`.
          storePersonal.value = [...storePersonal.value, newConfig]
        }
        return { newConfig, submit }
      },
      template: '<div class="speech-form-stub" @click="submit(); $emit(\'created\', newConfig)"></div>',
    }
    const wrapper = mountSection({}, { SpeechProviderCreateForm: SpeechFormStub })
    await flushPromises()

    // Open the modal.
    await wrapper.find('[data-testid="agent-speech-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.speech-form-stub').exists()).toBe(true)

    // Submit via the stubbed form — the section's onSpeechCreated
    // handler should auto-select the new id and write the override.
    await wrapper.find('.speech-form-stub').trigger('click')
    await flushPromises()

    // The dropdown now reflects the new id (selectedConfigId was
    // updated by onSpeechCreated, which triggers the watcher that
    // calls putSettings and synthAgentConfig).
    const select = wrapper.find('[data-testid="agent-speech-config-select"]')
    expect((select.element as HTMLSelectElement).value).toBe(String(NEW_ID))
    expect(agentPutSettingsMock).toHaveBeenCalledWith(
      OPENAI_CLASS,
      newConfig.settings,
      undefined,
    )
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('My Whisper')
    expect(badge.text()).toContain('agent override')

    // The modal closed after `created`.
    expect(wrapper.find('.speech-form-stub').exists()).toBe(false)
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

  it('surfaces an ApiError message inline when the override save fails', async () => {
    const { ApiError } = await import('@/api/client')
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    storeGlobal.value = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: { api_key: 'sk' },
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    agentPutSettingsMock.mockRejectedValueOnce(new ApiError('save failed', 'ERROR', 500))
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option')
      .find((o) => o.text().includes('Org-wide Whisper'))!
      .setSelected()
    await flushPromises()
    const errorEl = wrapper.find('[data-testid="agent-speech-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('save failed')
    // Dropdown rolled back to the previous value — the override was not
    // persisted, so the badge still shows the cascade default.
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('global default')
    expect(badge.text()).not.toContain('agent override')
  })
})
