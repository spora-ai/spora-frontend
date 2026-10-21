import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolTechnicalName from '@/components/tools/ToolTechnicalName.vue'
import { createAppI18n } from '@/i18n'

const makeTool = (overrides: Record<string, unknown> = {}) => ({
  tool_name: 'weather_api',
  display_name: 'Weather API',
  ...overrides,
})

describe('ToolTechnicalName', () => {
  it('shows the technical name when the display name differs from it', () => {
    const wrapper = mount(ToolTechnicalName, { props: { tool: makeTool() } })
    expect(wrapper.text()).toBe('weather_api')
  })

  it('shows nothing when the display name already is the technical name', () => {
    const wrapper = mount(ToolTechnicalName, {
      props: { tool: makeTool({ display_name: 'weather_api' }) },
    })
    expect(wrapper.find('span').exists()).toBe(false)
  })

  it('shows nothing when the tool has no display name', () => {
    const wrapper = mount(ToolTechnicalName, {
      props: { tool: makeTool({ display_name: null }) },
    })
    expect(wrapper.find('span').exists()).toBe(false)
  })

  it('carries the tooltip that explains the name to the LLM', () => {
    const wrapper = mount(ToolTechnicalName, { props: { tool: makeTool() } })
    expect(wrapper.attributes('title')).toBe('The name the LLM knows this tool by')
  })

  it('renders the German tooltip under the `de` instance', () => {
    const wrapper = mount(ToolTechnicalName, {
      props: { tool: makeTool() },
      global: { plugins: [[createAppI18n('de')]] },
    })
    expect(wrapper.attributes('title')).toBe('Der Name, unter dem das LLM dieses Werkzeug kennt')
  })
})
