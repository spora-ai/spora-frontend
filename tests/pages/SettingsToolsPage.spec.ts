/**
 * SettingsToolsPage — list of tools grouped by category; clicking a tool loads settings panel.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const routeMock = reactive<{ query: Record<string, string> }>({ query: {} })
const replaceMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}))

const getGlobalSettingsMock = vi.fn().mockResolvedValue({})
vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => ({ getGlobalSettings: getGlobalSettingsMock }),
}))

import SettingsToolsPage from '@/pages/settings/SettingsToolsPage.vue'

const tools = [
  { tool_class: 'CalculatorTool', tool_name: 'calculator', display_name: 'Calculator', category: 'general',
    settings_schema: [{ key: 'precision', label: 'Precision', type: 'text', description: '', default: '10', required: false, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'ScratchpadTool', tool_name: 'scratchpad', display_name: 'Scratchpad', category: 'general',
    settings_schema: [],
    operations: [] },
  { tool_class: 'NewsApiTool', tool_name: 'news_api', display_name: 'News API', category: 'research',
    settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password', description: '', default: '', required: true, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'GNewsTool', tool_name: 'g_news', display_name: 'GNews', category: 'research',
    settings_schema: [],
    operations: [] },
  { tool_class: 'CalDavCalendarTool', tool_name: 'cal_dav_calendar', display_name: 'CalDAV Calendar', category: 'communication',
    settings_schema: [{ key: 'caldav_url', label: 'URL', type: 'text', description: '', default: '', required: true, options: null, expose_to_llm: false }],
    operations: [] },
]

const allToolsRef = ref<typeof tools>(tools)
const loadingToolsRef = ref(false)

const ToolSettingsPanelStub = {
  name: 'ToolSettingsPanel',
  props: ['tool', 'globalDefaults', 'mode'],
  template: '<div class="settings-panel-stub" />',
}

// Each test mounts its own wrapper. The route-mock watch in the page
// subscribes to the module-level routeMock, so without explicit
// unmount the previous test's component would still receive updates
// and consume the next test's mock queue.
let mountedWrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  for (const k of Object.keys(routeMock.query)) delete routeMock.query[k]
  allToolsRef.value = tools
  loadingToolsRef.value = false
  getGlobalSettingsMock.mockReset().mockResolvedValue({})
  replaceMock.mockReset()
  mountedWrappers = []
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
})

function mountPage() {
  const wrapper = mount(SettingsToolsPage, {
    global: {
      provide: { settingsTools: { allTools: allToolsRef, loadingTools: loadingToolsRef } },
      stubs: { ToolSettingsPanel: ToolSettingsPanelStub, Icon: true, AlertBanner: true },
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('SettingsToolsPage', () => {
  it('renders the page title in list view', () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Tool Settings')
  })

  it('groups tools by category with configurable tools only', () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Calculator')
    expect(wrapper.text()).toContain('News API')
    expect(wrapper.text()).toContain('CalDAV Calendar')
    // Tools with empty settings_schema are not shown
    expect(wrapper.text()).not.toContain('Scratchpad')
    expect(wrapper.text()).not.toContain('GNews')
  })

  it('sorts categories case-insensitively', () => {
    allToolsRef.value = [
      { tool_class: 'A', tool_name: 'a', display_name: 'A', category: 'zebra', settings_schema: [{ key: 'k', label: 'L', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }], operations: [] },
      { tool_class: 'B', tool_name: 'b', display_name: 'B', category: 'general', settings_schema: [{ key: 'k', label: 'L', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }], operations: [] },
      { tool_class: 'C', tool_name: 'c', display_name: 'C', category: 'research', settings_schema: [{ key: 'k', label: 'L', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }], operations: [] },
    ]
    const wrapper = mountPage()
    const html = wrapper.html()
    const generalIdx = html.indexOf('General')
    const researchIdx = html.indexOf('Research')
    const zebraIdx = html.indexOf('Zebra')
    expect(generalIdx).toBeLessThan(researchIdx)
    expect(researchIdx).toBeLessThan(zebraIdx)
  })

  it('shows a loading message when loadingTools is true', () => {
    loadingToolsRef.value = true
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Loading')
  })

  it('shows an empty-state when no tools are configurable', () => {
    allToolsRef.value = []
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('No configurable tools')
  })

  it('selects a tool and renders the settings panel', async () => {
    const wrapper = mountPage()
    const newsRow = wrapper.findAll('button').find((b) => b.text().includes('News API'))!
    await newsRow.trigger('click')
    await flushPromises()
    expect(getGlobalSettingsMock).toHaveBeenCalledWith('news_api')
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-tools', query: { tool: 'news_api' } })
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(true)
  })

  it('handles getGlobalSettings failure gracefully', async () => {
    getGlobalSettingsMock.mockRejectedValue(new Error('boom'))
    const wrapper = mountPage()
    const row = wrapper.findAll('button').find((b) => b.text().includes('Calculator'))!
    await row.trigger('click')
    await flushPromises()
    // The panel still renders with empty defaults
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(true)
  })

  it('auto-selects the tool from the ?tool= query param on mount', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    expect(getGlobalSettingsMock).toHaveBeenCalledWith('calculator')
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(true)
  })

  it('updates the selected tool when the route query changes externally', async () => {
    const wrapper = mountPage()
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(false)
    routeMock.query.tool = 'calculator'
    await flushPromises()
    expect(getGlobalSettingsMock).toHaveBeenCalledWith('calculator')
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(true)
  })

  it('returns to the list view when the route query tool is cleared externally', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(true)
    delete routeMock.query.tool
    await flushPromises()
    expect(wrapper.find('.settings-panel-stub').exists()).toBe(false)
  })

  it('discards stale getGlobalSettings results when a newer tool is selected', async () => {
    let resolveA!: (v: Record<string, string>) => void
    let resolveB!: (v: Record<string, string>) => void
    getGlobalSettingsMock
      .mockImplementationOnce(
        () => new Promise<Record<string, string>>((r) => { resolveA = r }),
      )
      .mockImplementationOnce(
        () => new Promise<Record<string, string>>((r) => { resolveB = r }),
      )

    // Drive selection via the route query so both fetches can be in flight
    // simultaneously (clicking a row would unmount the list before the
    // second click could fire).
    routeMock.query.tool = 'news_api'
    const wrapper = mountPage()
    await flushPromises()
    routeMock.query.tool = 'calculator'
    await flushPromises()

    // Resolve in the "wrong" order — stale first, then current
    resolveA({ api_key: 'STALE' })
    await flushPromises()
    resolveB({ precision: 'CURRENT' })
    await flushPromises()

    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    expect(panel.props('tool')).toMatchObject({ tool_name: 'calculator' })
    expect(panel.props('globalDefaults')).toEqual({ precision: 'CURRENT' })
  })

  it('goes back to the list view when back is emitted from the panel', async () => {
    routeMock.query.tool = 'calculator'
    const wrapper = mountPage()
    await flushPromises()
    const panel = wrapper.findComponent({ name: 'ToolSettingsPanel' })
    await panel.vm.$emit('back')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-tools' })
  })

  it('toggles category collapse when a category header is clicked', async () => {
    const wrapper = mountPage()
    const generalHeader = wrapper.findAll('button').find((b) => b.text().includes('General'))!
    await generalHeader.trigger('click')
    // After collapsing, Calculator should no longer be visible
    expect(wrapper.text()).not.toContain('Calculator')
  })
})
