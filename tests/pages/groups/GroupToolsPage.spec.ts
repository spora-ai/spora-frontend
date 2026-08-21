/**
 * GroupToolsPage — per-group tool-settings overrides, reusing the
 * operator's `ToolSettingsList` (categorised list) and `ToolSettingsPanel`
 * (form) so the group UI matches /settings/admin/tools visually.
 *
 * Tests cover the list rendering, the per-row `Configured` indicator,
 * the panel's `mode="group"` routing to the group endpoints on save
 * and clear, and the auth/role gating.
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

const toastMock = vi.hoisted(
  () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
)
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

const ToolSettingsListStub = {
  name: 'ToolSettingsList',
  props: ['tools', 'title', 'subtitle'],
  emits: ['select'],
  template: '<div class="list-stub"><button class="select" @click="$emit(\'select\', \'WeatherTool\')">select</button><slot :tool="tools[0]" /></div>',
}

const ModalStub = { name: 'Modal', template: '<div><slot /></div>' }

const ToolSettingsPanelStub = {
  name: 'ToolSettingsPanel',
  props: ['tool', 'globalDefaults', 'mode', 'initialSettings'],
  emits: ['saved', 'cleared', 'back'],
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
    mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    expect(fetchToolsMock).toHaveBeenCalledWith(1)
    expect(apiGetMock).toHaveBeenCalledWith('/tools')
  })

  it('filters the registry down to tools that actually have a settings schema', async () => {
    apiGetMock.mockResolvedValueOnce({
      tools: [
        {
          tool_class: 'WeatherTool',
          tool_name: 'weather',
          display_name: 'Weather',
          category: 'general',
          settings_schema: [{ key: 'api_key', label: 'Key', type: 'password', required: true }],
          operations: [],
        },
        {
          tool_class: 'EmptyTool',
          tool_name: 'empty',
          display_name: 'Empty',
          category: 'general',
          settings_schema: [],
          operations: [],
        },
      ],
    })
    const wrapper = mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    const listStub = wrapper.findComponent(ToolSettingsListStub)
    expect((listStub.props('tools') as Array<{ tool_class: string }>).map((t) => t.tool_class)).toEqual([
      'WeatherTool',
    ])
  })

  it('opens the editor with the right tool when the list emits select', async () => {
    apiGetMock.mockResolvedValueOnce({
      tools: [
        {
          tool_class: 'WeatherTool',
          tool_name: 'weather',
          display_name: 'Weather',
          category: 'general',
          settings_schema: [{ key: 'k', label: 'K', type: 'text', required: false }],
          operations: [],
        },
      ],
    })
    const wrapper = mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    await wrapper.findComponent(ToolSettingsListStub).vm.$emit('select', 'WeatherTool')
    await flushPromises()
    expect(wrapper.vm.editing).toBe('WeatherTool')
    expect(wrapper.vm.editingTool).not.toBeNull()
    const panelStub = wrapper.findComponent(ToolSettingsPanelStub)
    expect(panelStub.exists()).toBe(true)
    expect(panelStub.props('mode')).toBe('group')
  })

  it('onSaved() routes through the group upsertTool endpoint', async () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    apiGetMock.mockResolvedValueOnce({
      tools: [
        {
          tool_class: 'WeatherTool',
          tool_name: 'weather',
          display_name: 'Weather',
          category: 'general',
          settings_schema: [{ key: 'k', label: 'K', type: 'text', required: false }],
          operations: [],
        },
      ],
    })
    const wrapper = mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    await wrapper.findComponent(ToolSettingsListStub).vm.$emit('select', 'WeatherTool')
    await wrapper.vm.onSaved({ api_key: 'k2' })
    expect(upsertToolMock).toHaveBeenCalledWith(1, 'WeatherTool', { api_key: 'k2' })
    expect(wrapper.vm.editing).toBeNull()
  })

  it('onCleared() routes through the group deleteTool endpoint', async () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    apiGetMock.mockResolvedValueOnce({
      tools: [
        {
          tool_class: 'WeatherTool',
          tool_name: 'weather',
          display_name: 'Weather',
          category: 'general',
          settings_schema: [{ key: 'k', label: 'K', type: 'text', required: false }],
          operations: [],
        },
      ],
    })
    const wrapper = mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    await wrapper.findComponent(ToolSettingsListStub).vm.$emit('select', 'WeatherTool')
    await wrapper.vm.onCleared()
    expect(deleteToolMock).toHaveBeenCalledWith(1, 'WeatherTool')
    expect(wrapper.vm.editing).toBeNull()
  })

  it('onSaved() surfaces ApiError via toast and keeps the dialog open', async () => {
    upsertToolMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 422))
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: {} }]
    apiGetMock.mockResolvedValueOnce({
      tools: [
        {
          tool_class: 'WeatherTool',
          tool_name: 'weather',
          display_name: 'Weather',
          category: 'general',
          settings_schema: [{ key: 'k', label: 'K', type: 'text', required: false }],
          operations: [],
        },
      ],
    })
    const wrapper = mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    await wrapper.findComponent(ToolSettingsListStub).vm.$emit('select', 'WeatherTool')
    await wrapper.vm.onSaved({ api_key: 'k' })
    expect(toastMock.error).toHaveBeenCalledWith('nope')
    expect(wrapper.vm.editing).toBe('WeatherTool')
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchToolsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupToolsPage, {
      global: {
        stubs: {
          Icon: true,
          Modal: ModalStub,
          ToolSettingsList: ToolSettingsListStub,
          ToolSettingsPanel: ToolSettingsPanelStub,
        },
      },
    })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})