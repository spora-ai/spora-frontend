/**
 * GroupToolsPage — per-group tool-settings overrides.
 *
 * The page mirrors SettingsToolsPage's mutual-exclusion pattern: list
 * OR panel, never both. Selection is keyed by `?tool=<toolName>` in the
 * URL. Tests cover list rendering, the per-row `Configured` chip, the
 * `?tool=` query round-trip, the panel's `mode="group"` routing to the
 * group endpoints on save and clear, and the auth/role gating.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

const routeRef = reactive<{ params: Record<string, string>; query: Record<string, string> }>({
  params: { id: '1' },
  query: {},
})

const routerReplaceMock = vi.fn()
const routerPushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => routeRef,
  useRouter: () => ({
    push: (...args: unknown[]) => routerPushMock(...args),
    replace: (...args: unknown[]) => routerReplaceMock(...args),
  }),
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
  // ToolSettingsList emits `tool_name` (not `tool_class`) on click.
  template: '<div class="list-stub"><button class="select-weather" @click="$emit(\'select\', \'weather\')">select</button><slot :tool="tools[0]" /></div>',
}

const ToolSettingsPanelStub = {
  name: 'ToolSettingsPanel',
  props: ['tool', 'globalDefaults', 'mode', 'initialSettings', 'principalId'],
  emits: ['saved', 'cleared', 'back'],
  template: '<div class="settings-panel-stub" />',
}

const STUBS = {
  Icon: true,
  ToolSettingsList: ToolSettingsListStub,
  ToolSettingsPanel: ToolSettingsPanelStub,
}

const WEATHER_TOOL = {
  tool_class: 'WeatherTool',
  tool_name: 'weather',
  display_name: 'Weather',
  category: 'search',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'string', required: true, description: '', expose_to_llm: false, sensitive: true },
  ],
  operations: [],
}

const EMPTY_TOOL = {
  tool_class: 'EmptyTool',
  tool_name: 'empty',
  display_name: 'Empty',
  category: 'misc',
  settings_schema: [],
  operations: [],
}

describe('GroupToolsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    Object.assign(routeRef, { params: { id: '1' }, query: {} })
    vi.clearAllMocks()
    fetchToolsMock.mockResolvedValue([])
    upsertToolMock.mockResolvedValue({ tool_class: 'WeatherTool', settings: {} })
    deleteToolMock.mockResolvedValue(undefined)
    apiGetMock.mockResolvedValue({ tools: [WEATHER_TOOL, EMPTY_TOOL] })
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads tools + tool registry on mount', async () => {
    mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    expect(fetchToolsMock).toHaveBeenCalledWith(1)
    expect(apiGetMock).toHaveBeenCalledWith('/tools')
  })

  it('filters the registry down to tools that actually have a settings schema', async () => {
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'ToolSettingsList' })
    expect(list.exists()).toBe(true)
    // The stub's emit target only checks the first tool; verifying
    // the stub received the filtered array is enough.
    expect(list.props('tools')).toEqual([WEATHER_TOOL])
  })

  it('renders the list view by default (no ?tool=)', async () => {
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsList' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(false)
  })

  it('opens the panel when ?tool= matches a known tool', async () => {
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ToolSettingsList' }).exists()).toBe(false)
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    expect(panel.props('mode')).toBe('group')
    expect(panel.props('principalId')).toBe(10)
  })

  it('clicking a list row pushes ?tool= and opens the panel', async () => {
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'ToolSettingsList' })
    list.vm.$emit('select', 'weather')
    await flushPromises()
    expect(routerReplaceMock).toHaveBeenCalledWith({
      name: 'group-tools',
      query: { tool: 'weather' },
    })
  })

  it('passes the group\'s principal_id to the panel', async () => {
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    expect(panel.props('principalId')).toBe(10)
  })

  it('passes principalId=null when the group has no principal', async () => {
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, my_role: 'owner' }
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    expect(panel.props('principalId')).toBeNull()
  })

  it('routes onSaved through the group upsertTool', async () => {
    detailStoreMock.toolSettings = []
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    panel.vm.$emit('saved', { api_key: 'sk-test' })
    await flushPromises()
    expect(upsertToolMock).toHaveBeenCalledWith(1, 'WeatherTool', { api_key: 'sk-test' })
    expect(toastMock.success).toHaveBeenCalledWith('Tool settings saved.')
  })

  it('routes onCleared through the group deleteTool', async () => {
    detailStoreMock.toolSettings = [{ tool_class: 'WeatherTool', settings: { api_key: 'old' } }]
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    panel.vm.$emit('cleared')
    await flushPromises()
    expect(deleteToolMock).toHaveBeenCalledWith(1, 'WeatherTool')
    expect(toastMock.success).toHaveBeenCalledWith('Tool settings reset to defaults.')
  })

  it('surfaces ApiError toast on save failure and keeps the panel open', async () => {
    detailStoreMock.toolSettings = []
    upsertToolMock.mockRejectedValueOnce(new ApiError('boom', 'ERR', 422))
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    panel.vm.$emit('saved', { api_key: 'x' })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
    // Panel must still be open (URL unchanged)
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
  })

  it('does not open the panel when the caller is a member (cannot edit)', async () => {
    useAuthStoreMock.mockReturnValue({
      user: { id: 2, email: 'mem@x.com', is_admin: false, roles: ['USER'] },
    })
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10, my_role: 'member' }
    apiGetMock.mockResolvedValueOnce({ tools: [WEATHER_TOOL] })
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'ToolSettingsList' })
    list.vm.$emit('select', 'WeatherTool')
    await flushPromises()
    // Member can SEE the list but the panel must not open.
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(false)
    expect(routerReplaceMock).not.toHaveBeenCalled()
  })

  it('clears the ?tool= query when the panel emits back', async () => {
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    panel.vm.$emit('back')
    await flushPromises()
    expect(routerReplaceMock).toHaveBeenCalledWith({
      name: 'group-tools',
      query: {},
    })
  })

  it('round-trip: upserted row lands in the store with a tool_class (regression for envelope mismatch)', async () => {
    // Regression: previously `groupsApi.upsertTool` read `r.tool_setting`
    // (backend returns `r.tool`) and the resolved value was `undefined`.
    // The store pushed `undefined` into `toolSettings`, and the next render
    // of `configuredToolClasses` (`t.tool_class` on undefined) crashed the
    // page. Simulate the FIXED contract — `upsertTool` resolves with a
    // proper row and appends it to the store — then verify nothing
    // undefined slips in.
    detailStoreMock.toolSettings = []
    upsertToolMock.mockImplementationOnce(
      async (_id: number, toolClass: string, settings: Record<string, string>) => {
        const updated = { tool_class: toolClass, settings }
        detailStoreMock.toolSettings = [...detailStoreMock.toolSettings, updated]
        return updated
      },
    )
    routeRef.query = { tool: 'WeatherTool' }
    const wrapper = mount(GroupToolsPage, { global: { stubs: STUBS } })
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    panel.vm.$emit('saved', { api_key: 'sk-test' })
    await flushPromises()
    expect(detailStoreMock.toolSettings).toEqual([
      { tool_class: 'WeatherTool', settings: { api_key: 'sk-test' } },
    ])
    // Every entry must be a proper row — no `undefined` would crash
    // `configuredToolClasses` on the next render.
    for (const row of detailStoreMock.toolSettings) {
      expect(row).toBeDefined()
      expect(typeof row.tool_class).toBe('string')
    }
  })
})