/**
 * ToolsSettingsPage — admin tools settings (global tool config).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive, ref } from 'vue'

const routeMock = reactive<{ query: Record<string, string> }>({ query: {} })
const replaceMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const getSettingsMock = vi.fn()
vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => ({ getSettings: getSettingsMock, getGlobalSettings: getSettingsMock }),
}))

import { api } from '@/api/client'
const getMock = api.get as ReturnType<typeof vi.fn>

import ToolsSettingsPage from '@/pages/admin/ToolsSettingsPage.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'

const testTools = [
  { tool_class: 'CalculatorTool', tool_name: 'calculator', display_name: 'Calculator', category: 'general',
    settings_schema: [{ key: 'precision', label: 'Precision', type: 'text', description: '', default: '10', required: false, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'NewsApiTool', tool_name: 'news_api', display_name: 'News API', category: 'research',
    settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password', description: '', default: '', required: true, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'NoopTool', tool_name: 'noop', display_name: 'Noop', category: 'general',
    settings_schema: [],
    operations: [] },
]

let mountedWrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  for (const k of Object.keys(routeMock.query)) delete routeMock.query[k]
  getMock.mockReset()
  getSettingsMock.mockReset()
  getSettingsMock.mockResolvedValue({})
  mountedWrappers = []
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
})

function mountPage() {
  // Default: pretend the caller is an admin, the tool registry has three
  // tools (two configurable, one with an empty schema), and every
  // per-tool /settings endpoint returns no overrides. Tests can
  // override individual responses after calling mountPage().
  getMock.mockImplementation(async (path: string) => {
    if (path === '/auth/me') return { user: { id: 1, email: 'a@b', is_admin: true } }
    if (path === '/tools') return { tools: testTools }
    if (typeof path === 'string' && /^\/tools\/[^/]+\/settings$/.test(path)) return { settings: {} }
    return {}
  })
  const wrapper = mount(ToolsSettingsPage, {
    global: { stubs: { RouterLink: true, Icon: true, AdminForbidden: true } },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('ToolsSettingsPage', () => {
  it('mounts without throwing', () => {
    const wrapper = mountPage()
    expect(wrapper.exists()).toBe(true)
  })

  it('loads the tool registry on mount', async () => {
    mountPage()
    await flushPromises()
    expect(getMock).toHaveBeenCalledWith('/tools')
  })

  it('populates the global settings store with the tool registry', async () => {
    mountPage()
    await flushPromises()
    const store = useGlobalSettingsStore()
    expect(store.allTools.map((t) => t.tool_name)).toEqual([
      'calculator', 'news_api', 'noop',
    ])
  })

  it('hides tools with an empty settings_schema from the configurable list', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('Calculator')
    expect(wrapper.text()).toContain('News API')
    expect(wrapper.text()).not.toContain('Noop')
  })

  it('selects a tool, renders the global settings panel, and routes by name', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const newsRow = wrapper.findAll('button').find((b) => b.text().includes('News API'))!
    await newsRow.trigger('click')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-tools', query: { tool: 'news_api' } })
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
  })

  it('goes back to the list view when back is emitted from the panel', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    expect(panel.exists()).toBe(true)
    await panel.vm.$emit('back')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-tools' })
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(false)
  })

  it('auto-selects the tool from the ?tool= query param on mount', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
  })

  it('updates the selected tool when the route query changes externally', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(false)
    routeMock.query.tool = 'calculator'
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
  })

  it('returns to the list view when the route query tool is cleared externally', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(true)
    delete routeMock.query.tool
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ToolSettingsPanel' }).exists()).toBe(false)
  })

  it('shows the "Global default" indicator for tools that have stored settings', async () => {
    getSettingsMock.mockImplementation(async (toolName: string) => {
      if (toolName === 'calculator') return { precision: '5' }
      return {}
    })
    const wrapper = mountPage()
    await flushPromises()
    // The indicator is rendered for Calculator (has settings) but not
    // for News API (no settings).
    const calculatorRow = wrapper.findAll('button').find((b) => b.text().includes('Calculator'))!
    const newsRow = wrapper.findAll('button').find((b) => b.text().includes('News API'))!
    expect(calculatorRow.text()).toContain('Global default')
    expect(newsRow.text()).not.toContain('Global default')
  })
})

// Suppress an unused-import warning for the helper ref exported above.
void ref
