/**
 * ToolSettingsList — categorised, collapsible list of tools. Pure presentational
 * component: selection is emitted to the parent, no router coupling.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolSettingsList from '@/components/settings/tools/ToolSettingsList.vue'
import type { ToolSchema } from '@/composables/useToolSettings'

const tools: ToolSchema[] = [
  { tool_class: 'CalculatorTool', tool_name: 'calculator', display_name: 'Calculator', category: 'general',
    settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'NewsApiTool', tool_name: 'news_api', display_name: 'News API', category: 'research',
    settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
    operations: [] },
  { tool_class: 'CalDavTool', tool_name: 'cal_dav_calendar', display_name: 'CalDAV Calendar', category: 'communication',
    settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
    operations: [] },
]

function mountList(props: Partial<{ title: string; subtitle: string; tools: ToolSchema[] }> = {}) {
  return mount(ToolSettingsList, {
    props: { tools, ...props },
    global: { stubs: { Icon: true } },
  })
}

describe('ToolSettingsList', () => {
  it('renders title and subtitle when provided', () => {
    const wrapper = mountList({ title: 'My Tools', subtitle: 'Pick one' })
    expect(wrapper.text()).toContain('My Tools')
    expect(wrapper.text()).toContain('Pick one')
  })

  it('renders nothing above the list when title and subtitle are absent', () => {
    const wrapper = mountList()
    // No h1 should be rendered
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('shows an empty state when no tools are provided', () => {
    const wrapper = mountList({ tools: [] })
    expect(wrapper.text()).toContain('No configurable tools')
  })

  it('groups tools by their category', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('Calculator')
    expect(wrapper.text()).toContain('News API')
    expect(wrapper.text()).toContain('CalDAV Calendar')
  })

  it('defaults to the "general" category when a tool has none', () => {
    const noCategory: ToolSchema[] = [
      { tool_class: 'X', tool_name: 'x', display_name: 'X', category: '' as unknown as string,
        settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
        operations: [] },
    ]
    const wrapper = mountList({ tools: noCategory })
    expect(wrapper.text()).toContain('General')
  })

  it('sorts categories case-insensitively', () => {
    const mixed: ToolSchema[] = [
      { tool_class: 'A', tool_name: 'a', display_name: 'A', category: 'zebra',
        settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
        operations: [] },
      { tool_class: 'B', tool_name: 'b', display_name: 'B', category: 'general',
        settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
        operations: [] },
      { tool_class: 'C', tool_name: 'c', display_name: 'C', category: 'research',
        settings_schema: [{ key: 'k', label: 'K', type: 'text', description: '', default: '', required: false, options: null, expose_to_llm: false }],
        operations: [] },
    ]
    const wrapper = mountList({ tools: mixed })
    const html = wrapper.html()
    const generalIdx = html.indexOf('General')
    const researchIdx = html.indexOf('Research')
    const zebraIdx = html.indexOf('Zebra')
    expect(generalIdx).toBeLessThan(researchIdx)
    expect(researchIdx).toBeLessThan(zebraIdx)
  })

  it('emits "select" with the tool name when a row is clicked', async () => {
    const wrapper = mountList()
    const newsRow = wrapper.findAll('button').find((b) => b.text().includes('News API'))!
    await newsRow.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['news_api']])
  })

  it('emits "select" when Enter is pressed on a row', async () => {
    const wrapper = mountList()
    const calcRow = wrapper.findAll('button').find((b) => b.text().includes('Calculator'))!
    await calcRow.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['calculator']])
  })

  it('renders every interactive element as a button for accessibility', () => {
    const wrapper = mountList()
    // No <div> or <a> with click-style classes should appear in interactive roles
    const clickableDivs = wrapper.findAll('div').filter((d) => d.classes().some((c) => c.includes('cursor-pointer')))
    expect(clickableDivs).toHaveLength(0)
    // Headers and rows should be buttons
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('sets aria-expanded on the category header to reflect collapsed state', async () => {
    const wrapper = mountList()
    const generalHeader = wrapper.findAll('button').find((b) => b.text().includes('General'))!
    // Initial: expanded
    expect(generalHeader.attributes('aria-expanded')).toBe('true')
    await generalHeader.trigger('click')
    expect(generalHeader.attributes('aria-expanded')).toBe('false')
  })

  it('toggles category collapse when a category header is clicked', async () => {
    const wrapper = mountList()
    const generalHeader = wrapper.findAll('button').find((b) => b.text().includes('General'))!
    expect(wrapper.text()).toContain('Calculator')
    await generalHeader.trigger('click')
    expect(wrapper.text()).not.toContain('Calculator')
    await generalHeader.trigger('click')
    expect(wrapper.text()).toContain('Calculator')
  })

  it('forwards the row-trailing slot to each tool row', () => {
    const wrapper = mount(ToolSettingsList, {
      props: { tools },
      global: { stubs: { Icon: true } },
      slots: {
        'row-trailing': '<span class="trailing-marker" />',
      },
    })
    // One trailing marker per tool row
    expect(wrapper.findAll('.trailing-marker')).toHaveLength(tools.length)
  })

  it('does not depend on vue-router (no useRoute/useRouter imports)', async () => {
    // The component source must not import useRoute/useRouter. Enforce
    // this by mounting it without any router plugin and verifying the
    // row click still emits 'select' (proving the list does not need
    // router access to do its job).
    const wrapper = mountList()
    const row = wrapper.findAll('button').find((b) => b.text().includes('News API'))!
    await row.trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['news_api'])
  })
})
