import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolTechnicalName from '@/components/tools/ToolTechnicalName.vue'
import { createAppI18n } from '@/i18n'

const makeTool = (overrides: Record<string, unknown> = {}) => ({
  tool_name: 'weather_api',
  display_name: 'Weather API',
  ...overrides,
})

function mountBadge(overrides: Record<string, unknown> = {}) {
  return mount(ToolTechnicalName, { props: { tool: makeTool(overrides) } })
}

describe('ToolTechnicalName', () => {
  it('shows the technical name when the display name differs from it', () => {
    const wrapper = mountBadge()
    expect(wrapper.find('[data-testid="tool-technical-name"]').text()).toBe('weather_api')
  })

  it('shows nothing when the display name already is the technical name', () => {
    const wrapper = mountBadge({ display_name: 'weather_api' })
    expect(wrapper.find('span').exists()).toBe(false)
  })

  it('shows nothing when the tool has no display name', () => {
    const wrapper = mountBadge({ display_name: null })
    expect(wrapper.find('span').exists()).toBe(false)
  })

  describe('the explanation bubble', () => {
    it('stays hidden until the badge is hovered', async () => {
      const wrapper = mountBadge()
      const tooltip = wrapper.find('[role="tooltip"]')
      expect(tooltip.classes()).toContain('hidden')
      expect(tooltip.text()).toBe('This is the tool invocation name the LLM sees')

      // The handlers sit on the wrapper; in a browser `mouseenter` fires on
      // every ancestor of the element the pointer entered, so hovering the
      // name itself opens the bubble.
      await wrapper.trigger('mouseenter')
      expect(tooltip.classes()).toContain('block')
      expect(tooltip.classes()).not.toContain('hidden')
    })

    it('hides again when the pointer leaves', async () => {
      const wrapper = mountBadge()
      await wrapper.trigger('mouseenter')
      await wrapper.trigger('mouseleave')
      expect(wrapper.find('[role="tooltip"]').classes()).toContain('hidden')
    })

    it('is not a focusable trigger, because it sits inside a row button', () => {
      // Two of the four surfaces render the badge inside a row <button>;
      // an interactive element inside a button is invalid HTML.
      const wrapper = mountBadge()
      expect(wrapper.find('[tabindex]').exists()).toBe(false)
    })

    it('renders the German explanation under the `de` instance', () => {
      const wrapper = mount(ToolTechnicalName, {
        props: { tool: makeTool() },
        global: { plugins: [[createAppI18n('de')]] },
      })
      expect(wrapper.find('[role="tooltip"]').text()).toBe(
        'Dies ist der Name, mit dem das LLM das Werkzeug aufruft',
      )
    })
  })
})
