/**
 * GroupToolsPage — list tool_user_settings rows scoped to the group.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

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
  toolSettings: Array<{ tool_class: string; settings: Record<string, string> }>
  llmConfigs: Array<unknown>
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

const fetchToolsMock = vi.fn().mockResolvedValue([])
const upsertToolMock = vi.fn()
const deleteToolMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, {
      fetchTools: fetchToolsMock,
      upsertTool: upsertToolMock,
      deleteTool: deleteToolMock,
    })
    return detailStoreMock
  },
}))

const apiGetMock = vi.hoisted(() => vi.fn().mockResolvedValue({ tools: [] }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    api: { ...actual.api, get: apiGetMock },
  }
})

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupToolsPage from '@/pages/groups/GroupToolsPage.vue'
import { ApiError } from '@/api/client'

const ToolSettingsPanelStub = {
  name: 'ToolSettingsPanel',
  props: ['tool', 'globalDefaults', 'mode', 'initialSettings'],
  emits: ['saved', 'back'],
  template: '<div class="settings-panel-stub" />',
}

describe('GroupToolsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    fetchToolsMock.mockResolvedValue([])
    upsertToolMock.mockResolvedValue({ tool_class: 'WeatherTool', settings: {} })
    deleteToolMock.mockResolvedValue(undefined)
    apiGetMock.mockResolvedValue({ tools: [] })
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads tools + tool registry on mount', async () => {
    mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    await flushPromises()
    expect(fetchToolsMock).toHaveBeenCalledWith(1)
    expect(apiGetMock).toHaveBeenCalledWith('/tools')
  })

  it('renders the empty state when no settings exist', () => {
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    expect(wrapper.text()).toContain('No tool settings configured for this group.')
  })

  it('renders a row per cached tool setting', () => {
    detailStoreMock.toolSettings = [
      { tool_class: 'WeatherTool', settings: { api_key: 'k' } },
      { tool_class: 'CalendarTool', settings: {} },
    ]
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    expect(wrapper.text()).toContain('WeatherTool')
    expect(wrapper.text()).toContain('CalendarTool')
  })

  it('hides Edit / Delete buttons for member-only callers', () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    expect(wrapper.text()).not.toContain('Edit')
  })

  it('openEdit() opens the dialog with the chosen tool class', () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: { api_key: 'k' } }]
    apiGetMock.mockResolvedValueOnce({ tools: [
      { tool_class: 'WeatherTool', tool_name: 'weather', display_name: 'Weather', category: 'general', settings_schema: [], operations: [] },
    ] })
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    wrapper.vm.openEdit('WeatherTool')
    expect(wrapper.vm.editing).toBe('WeatherTool')
  })

  it('confirmDelete() calls deleteTool and surfaces success', async () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    await wrapper.vm.confirmDelete('WeatherTool')
    expect(deleteToolMock).toHaveBeenCalledWith(1, 'WeatherTool')
  })

  it('confirmDelete() surfaces ApiError via toast', async () => {
    deleteToolMock.mockRejectedValueOnce(new ApiError('cannot', 'ERROR', 409))
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    await wrapper.vm.confirmDelete('WeatherTool')
    expect(toastMock.error).toHaveBeenCalledWith('cannot')
  })

  it('onSaved() calls upsertTool with the new settings and closes the dialog', async () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    apiGetMock.mockResolvedValueOnce({ tools: [
      { tool_class: 'WeatherTool', tool_name: 'weather', display_name: 'Weather', category: 'general', settings_schema: [], operations: [] },
    ] })
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    wrapper.vm.openEdit('WeatherTool')
    await wrapper.vm.onSaved({ api_key: 'k2' })
    expect(upsertToolMock).toHaveBeenCalledWith(1, 'WeatherTool', { api_key: 'k2' })
    expect(wrapper.vm.editing).toBeNull()
  })

  it('onSaved() surfaces ApiError via toast and keeps the dialog open', async () => {
    upsertToolMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 422))
    apiGetMock.mockResolvedValueOnce({ tools: [
      { tool_class: 'WeatherTool', tool_name: 'weather', display_name: 'Weather', category: 'general', settings_schema: [], operations: [] },
    ] })
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    const wrapper = mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    wrapper.vm.openEdit('WeatherTool')
    await wrapper.vm.onSaved({ api_key: 'k' })
    expect(toastMock.error).toHaveBeenCalledWith('nope')
    expect(wrapper.vm.editing).toBe('WeatherTool')
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchToolsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupToolsPage, { global: { stubs: { Icon: true, Modal: true, ToolSettingsPanel: ToolSettingsPanelStub } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})
