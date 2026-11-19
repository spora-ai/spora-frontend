/**
 * GroupLlmDriversPage — CRUD on llm_driver_configurations scoped to the group.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive, ref } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

interface DetailMock {
  group: Record<string, unknown> | null
  members: Array<unknown>
  agents: Array<unknown>
  toolSettings: Array<unknown>
  llmConfigs: Array<Record<string, unknown>>
  preferences: { principal_id: number; preferred_llm_config_id: number | null } | null
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: { id: 1, name: 'Eng', description: null, principal_id: 10, my_role: 'owner' },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    preferences: null,
    loading: false,
    error: null,
  }
}

/**
 * The page's `<script setup>` bindings — a `<script setup>` component publishes
 * only what `defineExpose` exports, so `internals(wrapper).startCreate` does
 * not type-check.
 */
type GroupLlmDriversPageVm = {
  mode: 'list' | 'create' | 'edit'
  showDelete: boolean
  startCreate: () => void
  cancel: () => void
  beginEdit: (config: Record<string, unknown>) => void
  confirmDelete: () => Promise<void>
  setDefault: () => Promise<void>
  clearPreferred: () => Promise<void>
  submitCreate: (settings: Record<string, string>) => Promise<void>
  submitEdit: (settings: Record<string, string>) => Promise<void>
  createForm: {
    name: string
    driverClass: string
    settings: Record<string, string>
    limits: { context_window: string; max_tokens_output: string }
    isDefault: boolean
  }
  editForm: {
    limits: { context_window: string; max_tokens_output: string }
    serverSettings: Record<string, string>
  }
}

function internals(wrapper: { vm: unknown }): GroupLlmDriversPageVm {
  return wrapper.vm as unknown as GroupLlmDriversPageVm
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const fetchLlmConfigsMock = vi.fn().mockResolvedValue([])
const createLlmConfigMock = vi.fn()
const updateLlmConfigMock = vi.fn()
const deleteLlmConfigMock = vi.fn()
const setDefaultLlmConfigMock = vi.fn()
const fetchPreferencesMock = vi.fn().mockResolvedValue({ principal_id: 10, preferred_llm_config_id: null })
const upsertPreferencesMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, {
      fetchLlmConfigs: fetchLlmConfigsMock,
      createLlmConfig: createLlmConfigMock,
      updateLlmConfig: updateLlmConfigMock,
      deleteLlmConfig: deleteLlmConfigMock,
      setDefaultLlmConfig: setDefaultLlmConfigMock,
      fetchPreferences: fetchPreferencesMock,
      upsertPreferences: upsertPreferencesMock,
    })
    return detailStoreMock
  },
}))

const driversRef = ref<Array<Record<string, unknown>>>([])
// The store owns the driver list; the test decides what the endpoint
// answered, so the mock never overwrites it.
const loadDriversMock = vi.fn().mockResolvedValue(undefined)
// The shared configurations every principal may name — the group's own list
// deliberately excludes them, so the preferred-config picker has to ask for
// them separately.
const globalConfigsRef = ref<Array<Record<string, unknown>>>([])
const loadGlobalConfigsMock = vi.fn().mockResolvedValue(undefined)
// The global load has its own error channel: the shared store error is
// cleared by every other operation, so a global failure parked there would
// vanish before the page could report it.
const globalConfigsErrorRef = ref<string | null>(null)
// Whether the global list is known. A failed load leaves it unknown, so the
// page cannot call a configuration missing on the strength of an empty list.
const globalConfigsLoadedRef = ref(true)
// The shared store error — the driver list shares it with the write paths.
const llmStoreErrorRef = ref<string | null>(null)
vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({
    get drivers() { return driversRef.value },
    get globalConfigs() { return globalConfigsRef.value },
    get globalConfigsError() { return globalConfigsErrorRef.value },
    get globalConfigsLoaded() { return globalConfigsLoadedRef.value },
    get error() { return llmStoreErrorRef.value },
    loadDrivers: loadDriversMock,
    loadGlobalConfigs: loadGlobalConfigsMock,
    driverForClass: (cls: string) => driversRef.value.find((d) => d.driver_class === cls),
  }),
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupLlmDriversPage from '@/pages/groups/GroupLlmDriversPage.vue'
import { ApiError } from '@/api/client'

const sampleConfig = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'My OpenAI',
  driver_class: 'OpenAI',
  driver_name: 'openai_compatible',
  driver_display_name: 'OpenAI',
  settings: { api_key: '***', model: 'gpt-4o' },
  context_window: null,
  max_tokens_output: null,
  is_default: false,
  is_global: false,
  principal_id: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const ToolSettingsFormStub = {
  name: 'ToolSettingsForm',
  props: ['tool', 'initialSettings', 'globalDefaults', 'saving', 'extraDirty'],
  emits: ['save'],
  template: '<div class="tool-settings-form-stub"><span v-for="(value, key) in initialSettings" :key="key" class="rendered-setting" :data-key="key">{{ value }}</span><button class="trigger-save" @click="$emit(\'save\', initialSettings)">save</button></div>',
}

const LLMConfigLimitsFieldsStub = {
  name: 'LLMConfigLimitsFields',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input class="limits-stub" :value="JSON.stringify(modelValue)" />',
}

describe('GroupLlmDriversPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    detailStoreMock.preferences = null
    vi.clearAllMocks()
    fetchLlmConfigsMock.mockResolvedValue([])
    fetchPreferencesMock.mockResolvedValue({ principal_id: 10, preferred_llm_config_id: null })
    upsertPreferencesMock.mockImplementation(async (_id, payload) => ({
      principal_id: 10,
      preferred_llm_config_id: payload.preferred_llm_config_id,
    }))
    createLlmConfigMock.mockResolvedValue(sampleConfig({ id: 11 }))
    updateLlmConfigMock.mockResolvedValue(sampleConfig({ name: 'Updated' }))
    deleteLlmConfigMock.mockResolvedValue(undefined)
    setDefaultLlmConfigMock.mockResolvedValue(sampleConfig({ is_default: true }))
    driversRef.value = [
      { name: 'openai_compatible', display_name: 'OpenAI', driver_class: 'OpenAI', settings_schema: [] },
    ]
    globalConfigsRef.value = []
    globalConfigsErrorRef.value = null
    globalConfigsLoadedRef.value = true
    llmStoreErrorRef.value = null
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads configs + drivers on mount', async () => {
    mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    expect(fetchLlmConfigsMock).toHaveBeenCalledWith(1)
    expect(loadDriversMock).toHaveBeenCalled()
  })

  it('renders the empty state when no configs exist', () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    expect(wrapper.text()).toContain('No LLM configurations for this group yet.')
  })

  it('renders one row per cached config', () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, name: 'A' }), sampleConfig({ id: 2, name: 'B' })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('B')
  })

  it('marks the default config visually', () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, is_default: true })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    expect(wrapper.text()).toContain('Default')
  })

  it('startCreate() switches to the create view', () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).startCreate()
    expect(internals(wrapper).mode).toBe('create')
  })

  it('beginEdit() switches to edit view and seeds the form', () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, name: 'Open', context_window: 4096 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(sampleConfig({ id: 1, name: 'Open', context_window: 4096 }))
    expect(internals(wrapper).mode).toBe('edit')
    expect(internals(wrapper).editForm.limits.context_window).toBe('4096')
  })

  it('submitCreate() calls createLlmConfig and switches to edit', async () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).createForm.name = 'New'
    internals(wrapper).createForm.driverClass = 'OpenAI'
    internals(wrapper).createForm.isDefault = true
    await internals(wrapper).submitCreate({ api_key: 'k' })
    expect(createLlmConfigMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'New', driver_class: 'OpenAI', is_default: true }))
    expect(internals(wrapper).mode).toBe('edit')
  })

  it('submitCreate() returns early when name is empty', async () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).createForm.name = ''
    internals(wrapper).createForm.driverClass = 'OpenAI'
    await internals(wrapper).submitCreate({})
    expect(createLlmConfigMock).not.toHaveBeenCalled()
  })

  it('submitCreate() surfaces ApiError via toast', async () => {
    createLlmConfigMock.mockRejectedValueOnce(new ApiError('fail', 'ERROR', 422))
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).createForm.name = 'New'
    internals(wrapper).createForm.driverClass = 'OpenAI'
    await internals(wrapper).submitCreate({})
    expect(toastMock.error).toHaveBeenCalledWith('fail')
  })

  it('submitEdit() omits unchanged password fields', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, settings: { api_key: '***', model: 'gpt-4o' } })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    await internals(wrapper).submitEdit({ api_key: '***', model: 'gpt-4o-mini' })
    expect(updateLlmConfigMock).toHaveBeenCalledWith(1, 1, expect.objectContaining({ settings: { model: 'gpt-4o-mini' } }))
  })

  it('confirmDelete() invokes deleteLlmConfig and resets the mode', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    internals(wrapper).showDelete = true
    await internals(wrapper).confirmDelete()
    expect(deleteLlmConfigMock).toHaveBeenCalledWith(1, 1)
    expect(internals(wrapper).mode).toBe('list')
  })

  it('confirmDelete() surfaces ApiError via toast', async () => {
    deleteLlmConfigMock.mockRejectedValueOnce(new ApiError('cannot', 'ERROR', 409))
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    internals(wrapper).showDelete = true
    await internals(wrapper).confirmDelete()
    expect(toastMock.error).toHaveBeenCalledWith('cannot')
  })

  it('setDefault() invokes setDefaultLlmConfig and triggers a refresh', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, is_default: false })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    await internals(wrapper).setDefault()
    expect(setDefaultLlmConfigMock).toHaveBeenCalledWith(1, 1)
    expect(fetchLlmConfigsMock).toHaveBeenCalledTimes(2)
  })

  it('cancel() returns to the list view', () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).startCreate()
    internals(wrapper).cancel()
    expect(internals(wrapper).mode).toBe('list')
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchLlmConfigsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })

  it('says so when the group has no default and the viewer cannot change it', () => {
    // Without the edit affordance the card shows the display sentence
    // rather than a select, so the "no default" wording has to render.
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    // The group's own default row answers before the global default, so
    // the sentence has to name both, in that order.
    expect(wrapper.text()).toContain(
      'No default set — agents will fall back to the group default, then the global default.',
    )
    expect(wrapper.text()).not.toContain('fall back to global default')
  })

  it('clearPreferred() clears the group default', async () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await internals(wrapper).clearPreferred()
    expect(upsertPreferencesMock).toHaveBeenCalledWith(1, { preferred_llm_config_id: null })
    expect(toastMock.success).toHaveBeenCalledWith('Group default cleared.')
  })

  it('offers the global configurations in the preferred-LLM picker', async () => {
    // The group's own list deliberately excludes the global rows, but the
    // backend accepts a global configuration as the group's preference — so
    // the picker has to offer them.
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, name: 'Group OpenAI' })]
    globalConfigsRef.value = [sampleConfig({ id: 12, name: 'Shared OpenAI', is_global: true, principal_id: null })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    const labels = wrapper
      .findAll('[data-testid="group-preferred-llm-select"] option')
      .map((option) => option.text())
    expect(labels).toEqual([
      '— No group default —',
      'Group OpenAI — OpenAI',
      'Shared OpenAI — OpenAI',
    ])
  })

  it('loads the global configurations on mount', async () => {
    mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    expect(loadGlobalConfigsMock).toHaveBeenCalled()
  })

  it('says so when the configurations could not be loaded', async () => {
    // The loader catches its own failure, so the page's own catch never sees
    // it — without the alert the operator cannot tell an incomplete list
    // from an empty one.
    globalConfigsErrorRef.value = 'Failed to load global configurations.'
    globalConfigsLoadedRef.value = false
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    expect(wrapper.find('[data-testid="group-llm-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Failed to load global configurations.')
  })

  it('reports a driver-list failure without offering a global retry', async () => {
    // The driver list seeds the create form; it shares the store's error
    // channel, and a retry of the global list would not answer for it.
    llmStoreErrorRef.value = 'Failed to load drivers.'
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    expect(wrapper.find('[data-testid="group-llm-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Failed to load drivers.')
    expect(wrapper.find('[data-testid="group-llm-retry"]').exists()).toBe(false)
  })

  it('offers a retry when the global configurations could not be loaded', async () => {    globalConfigsErrorRef.value = 'Failed to load global configurations.'
    globalConfigsLoadedRef.value = false
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    loadGlobalConfigsMock.mockClear()

    await wrapper.find('[data-testid="group-llm-retry"]').trigger('click')

    expect(loadGlobalConfigsMock).toHaveBeenCalled()
  })

  it('keeps the group-owned options usable when the global load failed', async () => {
    // The group's own configurations are still known — only the global list
    // is missing, so the picker must not lose the options it does have.
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, name: 'Group OpenAI' })]
    globalConfigsErrorRef.value = 'Failed to load global configurations.'
    globalConfigsLoadedRef.value = false
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    const labels = wrapper
      .findAll('[data-testid="group-preferred-llm-select"] option')
      .map((option) => option.text())
    expect(labels).toEqual([
      '— No group default —',
      'Group OpenAI — OpenAI',
    ])
    // The failure is reported rather than silently shortening the list.
    expect(wrapper.find('[data-testid="group-llm-error"]').exists()).toBe(true)
  })

  it('calls a saved configuration missing only once both lists have loaded', async () => {
    // The global configuration may well exist — the list that would say so
    // never arrived, so "(no longer exists)" would be a claim nobody made.
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    detailStoreMock.preferences = { principal_id: 10, preferred_llm_config_id: 12 }
    globalConfigsErrorRef.value = 'Failed to load global configurations.'
    globalConfigsLoadedRef.value = false
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    expect(wrapper.text()).not.toContain('no longer exists')
    expect(wrapper.text()).toContain('Config #12')

    // Once both lists have arrived, a configuration in neither of them is
    // missing — that is a claim the lists support.
    globalConfigsErrorRef.value = null
    globalConfigsLoadedRef.value = true
    await flushPromises()

    expect(wrapper.text()).toContain('no longer exists')
  })

  it('saves a global configuration as the group default', async () => {
    globalConfigsRef.value = [sampleConfig({ id: 12, name: 'Shared OpenAI', is_global: true, principal_id: null })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    await wrapper.find('[data-testid="group-preferred-llm-select"]').setValue('12')
    const saveBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Save')!
    await saveBtn.trigger('click')

    expect(upsertPreferencesMock).toHaveBeenCalledWith(1, { preferred_llm_config_id: 12 })
  })

  it('names the global configuration the group prefers', async () => {
    // Without the edit affordance the card shows the display sentence rather
    // than a select, and the global row has to be resolved against the
    // merged candidate list — the group's own list does not carry it.
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    detailStoreMock.preferences = { principal_id: 10, preferred_llm_config_id: 12 }
    globalConfigsRef.value = [sampleConfig({ id: 12, name: 'Shared OpenAI', is_global: true, principal_id: null })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('Shared OpenAI')
    expect(wrapper.text()).not.toContain('no longer exists')
  })

  it('clearPreferred() surfaces a non-ApiError failure via toast', async () => {
    upsertPreferencesMock.mockRejectedValueOnce(new Error('network exploded'))
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await internals(wrapper).clearPreferred()
    expect(toastMock.error).toHaveBeenCalledWith('Failed to save group default.')
  })

  it('submitEdit() surfaces a non-ApiError failure via toast', async () => {
    updateLlmConfigMock.mockRejectedValueOnce(new Error('network exploded'))
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    await internals(wrapper).submitEdit({ api_key: '***', model: 'gpt-4o-mini' })
    expect(toastMock.error).toHaveBeenCalledWith('Failed to update configuration.')
  })

  it('setDefault() surfaces a non-ApiError failure via toast', async () => {
    setDefaultLlmConfigMock.mockRejectedValueOnce(new Error('network exploded'))
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).beginEdit(detailStoreMock.llmConfigs[0])
    await internals(wrapper).setDefault()
    expect(toastMock.error).toHaveBeenCalledWith('Failed to set default.')
  })

  it('renders a driver setting default as JSON, and falls back when JSON fails', async () => {
    // A driver ships any JSON as a setting default. `String()` on an object
    // renders "[object Object]", which tells the operator nothing — the
    // form has to show the value itself.
    const circular: Record<string, unknown> = {}
    circular.self = circular
    driversRef.value = [
      {
        name: 'openai_compatible',
        display_name: 'OpenAI',
        driver_class: 'OpenAI',
        settings_schema: [
          { key: 'headers', default: { 'x-tenant': 'acme' } },
          { key: 'retries', default: 3 },
          { key: 'loop', default: circular },
        ],
      },
    ]

    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    internals(wrapper).startCreate()
    await wrapper.vm.$nextTick()
    await wrapper.find('#group-llm-driver').setValue('OpenAI')

    // The form renders the defaults the driver declared.
    const rendered = wrapper.findAll('.rendered-setting').map((el) => [el.attributes('data-key'), el.text()])
    expect(rendered).toEqual([
      ['headers', '{"x-tenant":"acme"}'],
      ['retries', '3'],
      // A default that JSON cannot express still shows as something.
      ['loop', '[object Object]'],
    ])
  })
})
