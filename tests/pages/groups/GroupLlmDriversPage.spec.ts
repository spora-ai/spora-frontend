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
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const fetchLlmConfigsMock = vi.fn().mockResolvedValue([])
const createLlmConfigMock = vi.fn()
const updateLlmConfigMock = vi.fn()
const deleteLlmConfigMock = vi.fn()
const setDefaultLlmConfigMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, {
      fetchLlmConfigs: fetchLlmConfigsMock,
      createLlmConfig: createLlmConfigMock,
      updateLlmConfig: updateLlmConfigMock,
      deleteLlmConfig: deleteLlmConfigMock,
      setDefaultLlmConfig: setDefaultLlmConfigMock,
    })
    return detailStoreMock
  },
}))

const driversRef = ref<Array<Record<string, unknown>>>([])
const loadDriversMock = vi.fn().mockImplementation(async () => {
  driversRef.value = [
    {
      name: 'openai_compatible',
      display_name: 'OpenAI',
      driver_class: 'OpenAI',
      settings_schema: [],
    },
  ]
})
vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({
    drivers: driversRef,
    loadDrivers: loadDriversMock,
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
  template: '<div class="tool-settings-form-stub"><button class="trigger-save" @click="$emit(\'save\', initialSettings)">save</button></div>',
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
    vi.clearAllMocks()
    fetchLlmConfigsMock.mockResolvedValue([])
    createLlmConfigMock.mockResolvedValue(sampleConfig({ id: 11 }))
    updateLlmConfigMock.mockResolvedValue(sampleConfig({ name: 'Updated' }))
    deleteLlmConfigMock.mockResolvedValue(undefined)
    setDefaultLlmConfigMock.mockResolvedValue(sampleConfig({ is_default: true }))
    driversRef.value = [
      { name: 'openai_compatible', display_name: 'OpenAI', driver_class: 'OpenAI', settings_schema: [] },
    ]
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
    wrapper.vm.startCreate()
    expect(wrapper.vm.mode).toBe('create')
  })

  it('beginEdit() switches to edit view and seeds the form', () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, name: 'Open', context_window: 4096 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.beginEdit(sampleConfig({ id: 1, name: 'Open', context_window: 4096 }))
    expect(wrapper.vm.mode).toBe('edit')
    expect(wrapper.vm.editForm.limits.context_window).toBe('4096')
  })

  it('submitCreate() calls createLlmConfig and switches to edit', async () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.createForm.name = 'New'
    wrapper.vm.createForm.driverClass = 'OpenAI'
    wrapper.vm.createForm.isDefault = true
    await wrapper.vm.submitCreate({ api_key: 'k' })
    expect(createLlmConfigMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'New', driver_class: 'OpenAI', is_default: true }))
    expect(wrapper.vm.mode).toBe('edit')
  })

  it('submitCreate() returns early when name is empty', async () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.createForm.name = ''
    wrapper.vm.createForm.driverClass = 'OpenAI'
    await wrapper.vm.submitCreate({})
    expect(createLlmConfigMock).not.toHaveBeenCalled()
  })

  it('submitCreate() surfaces ApiError via toast', async () => {
    createLlmConfigMock.mockRejectedValueOnce(new ApiError('fail', 'ERROR', 422))
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.createForm.name = 'New'
    wrapper.vm.createForm.driverClass = 'OpenAI'
    await wrapper.vm.submitCreate({})
    expect(toastMock.error).toHaveBeenCalledWith('fail')
  })

  it('submitEdit() omits unchanged password fields', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, settings: { api_key: '***', model: 'gpt-4o' } })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.beginEdit(detailStoreMock.llmConfigs[0])
    await wrapper.vm.submitEdit({ api_key: '***', model: 'gpt-4o-mini' })
    expect(updateLlmConfigMock).toHaveBeenCalledWith(1, 1, expect.objectContaining({ settings: { model: 'gpt-4o-mini' } }))
  })

  it('confirmDelete() invokes deleteLlmConfig and resets the mode', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.beginEdit(detailStoreMock.llmConfigs[0])
    wrapper.vm.showDelete = true
    await wrapper.vm.confirmDelete()
    expect(deleteLlmConfigMock).toHaveBeenCalledWith(1, 1)
    expect(wrapper.vm.mode).toBe('list')
  })

  it('confirmDelete() surfaces ApiError via toast', async () => {
    deleteLlmConfigMock.mockRejectedValueOnce(new ApiError('cannot', 'ERROR', 409))
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1 })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.beginEdit(detailStoreMock.llmConfigs[0])
    wrapper.vm.showDelete = true
    await wrapper.vm.confirmDelete()
    expect(toastMock.error).toHaveBeenCalledWith('cannot')
  })

  it('setDefault() invokes setDefaultLlmConfig and triggers a refresh', async () => {
    detailStoreMock.llmConfigs = [sampleConfig({ id: 1, is_default: false })]
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.beginEdit(detailStoreMock.llmConfigs[0])
    await wrapper.vm.setDefault()
    expect(setDefaultLlmConfigMock).toHaveBeenCalledWith(1, 1)
    expect(fetchLlmConfigsMock).toHaveBeenCalledTimes(2)
  })

  it('cancel() returns to the list view', () => {
    const wrapper = mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    wrapper.vm.startCreate()
    wrapper.vm.cancel()
    expect(wrapper.vm.mode).toBe('list')
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchLlmConfigsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupLlmDriversPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsForm: ToolSettingsFormStub, LLMConfigLimitsFields: LLMConfigLimitsFieldsStub } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})
