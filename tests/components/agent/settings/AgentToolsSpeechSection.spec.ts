/**
 * AgentToolsSpeechSection — per-agent speech-to-text provider override.
 *
 * Mounts the section against a mock `useSpeechProviderConfigsStore` and
 * `useAgentStore`. Covers: empty state, cascade-source badge (agent
 * override > user > group > global > not configured), the dropdown UX
 * that picks an existing speech config (user / group / global) to
 * override the cascade — mirroring AgentLlmSection's LLM-config
 * select — and the inline `+ New` create modal (mirrors
 * AgentLlmConfigModal).
 *
 * Wire shape: PATCH /agents/{id} with `{ speech_driver_config_id }`.
 * The FK lives on the agents row (migration 0081 column, 0082 FK
 * constraint) and is read by the cascade's tier 1
 * (`SpeechToTextRegistry::loadAgentSpeechConfig`). The legacy
 * `useToolSettings.putSettings/deleteSettings` path used to write to
 * `agent_tool_overrides` is gone — that endpoint 404s for the speech
 * tool class.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive, computed } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const ensureMock = vi.fn()
const loadConfigsForMock = vi.fn()
const loadPreferenceMock = vi.fn().mockResolvedValue(undefined)
const setPreferredSlotMock = vi.fn()
const storeProviders = ref<Array<Record<string, unknown>>>([])
const storeError = ref<string | null>(null)

// Per-principal slot cache. The store keys the cache by slot, where a
// slot is `'user'` (unscoped caller view) or a numeric principal id
// (agent or group page). Tests seed the slot that matches the agent
// they're rendering.
type SlotKey = number | 'user'

interface Slot {
  configs: Array<Record<string, unknown>>
  preferredSpeech: { scope?: string; config_id: number | null } | null
  loadingConfigs: boolean
  loadingPreference: boolean
  loaded: boolean
  error: string | null
}

const slots = reactive(new Map<SlotKey, Slot>())

function getSlot(key: SlotKey): Slot {
  let slot = slots.get(key)
  if (!slot) {
    slot = reactive<Slot>({
      configs: [],
      preferredSpeech: null,
      loadingConfigs: false,
      loadingPreference: false,
      loaded: false,
      error: null,
    })
    slots.set(key, slot)
  }
  return slot
}

const storeMock = reactive({
  providers: storeProviders,
  error: storeError,
  ensure: ensureMock,
  loadConfigsFor: loadConfigsForMock,
  loadPreference: loadPreferenceMock,
  setPreferredSlot: setPreferredSlotMock,
  getSlot,
  providerByClass: (cls: string) => storeProviders.value.find((p: SpeechProviderClassSchema) => p.class === cls),
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

// `useAgentStore` — owns the agent row + PATCH round-trip. The
// component reads `currentAgent.speech_driver_config_id` for tier 1
// of the cascade and calls `updateAgent(id, {speech_driver_config_id})`
// on dropdown change.
const currentAgentRef = ref<Record<string, unknown> | null>(null)
const updateAgentMock = vi.fn()

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get currentAgent() { return currentAgentRef.value },
    set currentAgent(v: typeof currentAgentRef.value) { currentAgentRef.value = v },
    updateAgent: updateAgentMock,
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
import type { SpeechProviderClassSchema } from '@/types/speechProviderConfig'

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
  const merged = {
    agent: { id: 1, principal_id: 10, principal: { type: 'user', group_id: null }, speech_driver_config_id: null, tools: [] },
    agentId: 1,
    ...props,
  }
  // Mirror the prop's agent shape onto the agent store's currentAgent
  // unless the test already set `currentAgentRef.value` with explicit
  // overrides (preserve FK + principal set before mount). Tests that
  // rely on principal context must seed `currentAgentRef.value`
  // themselves via the override path in `beforeEach`.
  if (currentAgentRef.value === null) {
    currentAgentRef.value = merged.agent
  }
  return mount(AgentToolsSpeechSection, {
    props: merged,
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
  loadConfigsForMock.mockResolvedValue(undefined)
  loadPreferenceMock.mockResolvedValue(undefined)
  setPreferredSlotMock.mockReset()
  storeProviders.value = [openAiProvider]
  slots.clear()
  storeError.value = null
  capabilityEffectiveClass.value = null
  capabilityEffectiveSource.value = null
  currentAgentRef.value = {
    id: 1,
    principal_id: 10,
    principal: { type: 'user', group_id: null },
    speech_driver_config_id: null,
    tools: [],
  }
  updateAgentMock.mockImplementation(async (_id: number, patch: Record<string, unknown>) => {
    // Mirror the real service: PATCH response carries the canonical row
    // back so the store reflects the new value without a follow-up fetch.
    if (currentAgentRef.value && Object.prototype.hasOwnProperty.call(patch, 'speech_driver_config_id')) {
      currentAgentRef.value = {
        ...currentAgentRef.value,
        speech_driver_config_id: patch.speech_driver_config_id,
      }
    }
    return currentAgentRef.value
  })
})

describe('AgentToolsSpeechSection', () => {
  it('renders the empty state CTA when no override exists', async () => {
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('[data-testid="agent-speech-create"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Set STT provider')
    expect(wrapper.find('[data-testid="agent-speech-config-select"]').exists()).toBe(false)
  })

  it('shows "agent override" badge when the agent has a speech_driver_config_id FK', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'global',
        display_name: 'Org-wide Whisper',
        settings: {},
        is_global: true,
        principal_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    currentAgentRef.value = {
      ...currentAgentRef.value!,
      speech_driver_config_id: 200,
    }
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('agent override')
  })

  it('falls back to user default when no agent override exists', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'user_preference'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 99,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'user',
        display_name: 'Personal Voxtral',
        settings: {},
        is_global: false,
        principal_id: 1,
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
    getSlot(1).configs = [
      {
        id: 50,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'group',
        display_name: 'Team Whisper',
        settings: {},
        is_global: false,
        principal_id: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection({
      agent: { id: 1, principal_id: 10, principal: { type: 'group', group_id: 5 }, speech_driver_config_id: null, tools: [] },
    })
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Team Whisper')
    expect(badge.text()).toContain('group default')
  })

  it('falls back to global default when no agent/user/group config', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200,
        provider_class: OPENAI_CLASS,
        provider_display_name: 'OpenAI Compatible',
        scope: 'global',
        display_name: 'Org-wide Whisper',
        settings: {},
        is_global: true,
        principal_id: null,
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

  it('falls back to the "fallback" badge when the backend picks first-configured-wins', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'fallback'
    storeProviders.value = [
      {
        class: OPENAI_CLASS,
        display_name: 'Bundled Voxtral',
        configured: true,
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Bundled Voxtral')
    expect(badge.text()).toContain('fallback')
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
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 201, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Global Mistral', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 50, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'group', display_name: 'Team Whisper', settings: {},
        is_global: false, principal_id: 2,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 99, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'user', display_name: 'Personal Voxtral', settings: {},
        is_global: false, principal_id: 1,
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

  it('selecting a config PATCHes the agent with the FK id (regression: legacy tool-override endpoint 404s for speech)', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    // Sanity: cascade default is in effect, no agent override yet.
    let badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('global default')
    expect(badge.text()).not.toContain('agent override')
    expect(updateAgentMock).not.toHaveBeenCalled()

    const options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option')
    const globalOption = options.find((o) => o.text().includes('Org-wide Whisper'))!
    await globalOption.setSelected()
    await flushPromises()

    // Single PATCH round-trip — no settings blob, just the FK.
    expect(updateAgentMock).toHaveBeenCalledWith(1, { speech_driver_config_id: 200 })
    // The mock's updateAgent mutates `currentAgentRef.value`, which the
    // computed `agentOverride` re-derives on the next tick.
    badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('agent override')
  })

  it('selecting "Use cascade default" clears the FK back to null', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    // Seed an FK pointing at the global config — the dropdown should
    // pre-select id 200 on load.
    currentAgentRef.value = {
      ...currentAgentRef.value!,
      speech_driver_config_id: 200,
    }
    const wrapper = mountSection()
    await flushPromises()
    let badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('agent override')

    // Switch to "Use cascade default" — should clear the FK.
    const options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option')
    const defaultOption = options.find((o) => o.text().includes('Use cascade default'))!
    await defaultOption.setSelected()
    await flushPromises()

    expect(updateAgentMock).toHaveBeenCalledWith(1, { speech_driver_config_id: null })
    badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('Org-wide Whisper')
    expect(badge.text()).toContain('global default')
    expect(badge.text()).not.toContain('agent override')
  })

  it('+ New button opens an inline create modal', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    const wrapper = mountSection()
    await flushPromises()
    const newBtn = wrapper.find('[data-testid="agent-speech-create"]')
    expect(newBtn.exists()).toBe(true)
    expect(newBtn.text()).toContain('+ New')

    expect(wrapper.find('.modal-stub').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).exists()).toBe(false)

    await newBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('.modal-stub').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).exists()).toBe(true)
  })

  it('+ New → created event auto-selects the new config via PATCH', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
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
      is_global: false,
      principal_id: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const SpeechFormStub = {
      name: 'SpeechProviderCreateForm',
      props: ['scope', 'groupId'],
      emits: ['created', 'cancel'],
      setup() {
        function submit(): void {
          // The production flow calls `store.loadConfigsFor(agentId, agentId)`
          // from `onSpeechCreated` after the modal closes, which lands
          // the new config in the agent's slot. The mock doesn't
          // auto-refresh, so we drop the row into the slot directly to
          // match the post-refresh state the component observes.
          getSlot(1).configs = [...getSlot(1).configs, newConfig]
        }
        return { newConfig, submit }
      },
      template: '<div class="speech-form-stub" @click="submit(); $emit(\'created\', newConfig)"></div>',
    }
    const wrapper = mountSection({}, { SpeechProviderCreateForm: SpeechFormStub })
    await flushPromises()

    await wrapper.find('[data-testid="agent-speech-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.speech-form-stub').exists()).toBe(true)

    await wrapper.find('.speech-form-stub').trigger('click')
    await flushPromises()

    const select = wrapper.find('[data-testid="agent-speech-config-select"]')
    expect((select.element as HTMLSelectElement).value).toBe(String(NEW_ID))
    expect(updateAgentMock).toHaveBeenCalledWith(1, { speech_driver_config_id: NEW_ID })
    const badge = wrapper.find('[data-testid="agent-speech-cascade"]')
    expect(badge.text()).toContain('My Whisper')
    expect(badge.text()).toContain('agent override')

    expect(wrapper.find('.speech-form-stub').exists()).toBe(false)
  })

  it('surfaces an ApiError message inline when the FK save fails', async () => {
    const { ApiError } = await import('@/api/client')
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'global_default'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 200, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'global', display_name: 'Org-wide Whisper', settings: {},
        is_global: true, principal_id: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    updateAgentMock.mockRejectedValueOnce(new ApiError('save failed', 'ERROR', 500))
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

  it('pre-selects the user-preferred config when no agent override is set', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'user_preference'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 99, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'user', display_name: 'Personal Voxtral', settings: {},
        is_global: false, principal_id: 10,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    getSlot(1).preferredSpeech = { scope: 'user', config_id: 99 }
    const wrapper = mountSection()
    await flushPromises()
    const select = wrapper.find<HTMLSelectElement>('[data-testid="agent-speech-config-select"]')
    expect(Number(select.element.value)).toBe(99)
  })

  it('pre-selects the group-preferred config when the agent is group-owned', async () => {
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'group_preference'
    storeProviders.value = [openAiProvider]
    getSlot(1).configs = [
      {
        id: 50, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'group', display_name: 'Team Whisper', settings: {},
        is_global: false, principal_id: 11,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    getSlot(1).preferredSpeech = { scope: 'group', config_id: 50 }
    currentAgentRef.value = {
      id: 1, principal_id: 11,
      principal: { type: 'group', group_id: 5 },
      speech_driver_config_id: null, tools: [],
    }
    const wrapper = mountSection()
    await flushPromises()
    const select = wrapper.find<HTMLSelectElement>('[data-testid="agent-speech-config-select"]')
    expect(Number(select.element.value)).toBe(50)
  })

  it('passes agentId to store.ensure (and a second agentId argument for the agent-scope endpoint) so the backend narrows by agent scope', async () => {
    mountSection()
    await flushPromises()
    expect(ensureMock).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({ kind: 'user' }),
    )
  })

  it('passes the group preferred-scope to store.ensure when the agent is group-owned', async () => {
    currentAgentRef.value = {
      id: 1, principal_id: 11,
      principal: { type: 'group', group_id: 5 },
      speech_driver_config_id: null, tools: [],
    }
    mountSection()
    await flushPromises()
    expect(ensureMock).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({ kind: 'group', groupId: 5 }),
    )
  })

  it('passes props.agentId into capability.refresh() so the badge resolves against the agent principal', async () => {
    mountSection({ agentId: 42 })
    await flushPromises()
    expect(capabilityRefreshMock).toHaveBeenCalledWith(42)
  })

  it('re-runs capability.refresh() and ensure() with the new agent id when the agentId prop changes (navigate between agents)', async () => {
    const wrapper = mountSection({ agentId: 8 })
    await flushPromises()
    expect(capabilityRefreshMock).toHaveBeenLastCalledWith(8)
    expect(ensureMock).toHaveBeenLastCalledWith(8, 8, expect.objectContaining({ kind: 'user' }))

    // Navigate to a different agent — the prop-change watcher must
    // refresh the capability against the new agent and re-ensure the
    // new slot, otherwise the badge would keep resolving against
    // agent 8's principal and the dropdown would show agent 8's rows.
    await wrapper.setProps({ agentId: 9 })
    await flushPromises()
    expect(capabilityRefreshMock).toHaveBeenLastCalledWith(9)
    expect(ensureMock).toHaveBeenLastCalledWith(9, 9, expect.objectContaining({ kind: 'user' }))
  })

  it('switches the dropdown to the new principal scope when agentId changes from a user-owned to a group-owned agent', async () => {
    // Seed agent 1 with user-scope configs only.
    getSlot(1).configs = [
      {
        id: 99, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'user', display_name: 'Personal Voxtral', settings: {},
        is_global: false, principal_id: 10,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'user_preference'

    const wrapper = mountSection({
      agent: { id: 1, principal_id: 10, principal: { type: 'user', group_id: null }, speech_driver_config_id: null, tools: [] },
      agentId: 1,
    })
    await flushPromises()
    // Sanity: the dropdown starts on the user-owned principal's rows.
    let optionTexts = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option').map((o) => o.text())
    expect(optionTexts.slice(1)).toEqual(['Personal Voxtral (user)'])

    // Now switch to agent 2 — a group-owned agent. The watcher must
    // call `ensure(2, 2, ...)` which populates slot 2 with the
    // group-principal configs the test seeds below.
    getSlot(2).configs = [
      {
        id: 50, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'group', display_name: 'Team Whisper', settings: {},
        is_global: false, principal_id: 11,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    currentAgentRef.value = {
      id: 2, principal_id: 11,
      principal: { type: 'group', group_id: 5 },
      speech_driver_config_id: null, tools: [],
    }
    await wrapper.setProps({
      agent: { id: 2, principal_id: 11, principal: { type: 'group', group_id: 5 }, speech_driver_config_id: null, tools: [] },
      agentId: 2,
    })
    await flushPromises()

    // The dropdown now reflects slot 2's group-scope configs only —
    // agent 1's user-scope row is no longer visible because the slot
    // key changed.
    optionTexts = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option').map((o) => o.text())
    expect(optionTexts.slice(1)).toEqual(['Team Whisper (group)'])
    expect(optionTexts.slice(1).some((t) => t.includes('Personal Voxtral'))).toBe(false)
  })

  it('survives a same-agent remount without a refetch (idempotent ensure)', async () => {
    // Make the mock `ensure` actually trigger the underlying fetches
    // so we can observe whether a remount re-issues the network call.
    // This mirrors the real store's idempotency check: skip if the
    // slot is already loaded.
    ensureMock.mockImplementation(async (key, agentId) => {
      const existing = slots.get(key)
      if (existing?.loaded === true) return
      await loadConfigsForMock(key, agentId)
      getSlot(key).loaded = true
    })

    const wrapper1 = mountSection({ agentId: 1 })
    await flushPromises()
    expect(loadConfigsForMock).toHaveBeenCalledTimes(1)

    // Unmount and remount against the same agentId — the slot is
    // already loaded from the first mount, so the second mount's
    // `ensure` short-circuits and `loadConfigsFor` is NOT called
    // again. This is the regression for the old global `initialized`
    // flag: that flag froze across mounts, but per-slot loaded is
    // set by the slot itself, not a separate global.
    wrapper1.unmount()
    mountSection({ agentId: 1 })
    await flushPromises()
    expect(loadConfigsForMock).toHaveBeenCalledTimes(1)
  })

  it('shows the empty dropdown briefly while the new slot loads on agent switch', async () => {
    // Seed agent 1 with rows so the dropdown has options on first mount.
    getSlot(1).configs = [
      {
        id: 99, provider_class: OPENAI_CLASS, provider_display_name: 'OpenAI Compatible',
        scope: 'user', display_name: 'Personal Voxtral', settings: {},
        is_global: false, principal_id: 10,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    capabilityEffectiveClass.value = OPENAI_CLASS
    capabilityEffectiveSource.value = 'user_preference'

    const wrapper = mountSection({ agentId: 1 })
    await flushPromises()
    let options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option').map((o) => o.text())
    expect(options.slice(1)).toContain('Personal Voxtral (user)')

    // Slow down the second `ensure` so the test can observe the
    // mid-load state — the new slot is empty until the fetch lands.
    let resolveEnsure!: () => void
    ensureMock.mockImplementationOnce(() => new Promise<void>((r) => { resolveEnsure = r }))

    // Trigger the agentId change. The watcher fires `ensure(2, 2, ...)`,
    // which we just slowed down. The computed `slot` re-evaluates
    // against slot 2 (which is empty), so the dropdown briefly
    // surfaces only the placeholder.
    await wrapper.setProps({ agentId: 2 })
    await flushPromises()

    options = wrapper.find('[data-testid="agent-speech-config-select"]').findAll('option').map((o) => o.text())
    expect(options).toEqual(['— Use cascade default —'])

    // Resolve the in-flight ensure so the test doesn't leak a pending
    // promise to the next test.
    resolveEnsure()
    await flushPromises()
  })
})
