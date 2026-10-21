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

      await wrapper.find('[tabindex="0"]').trigger('mouseenter')
      expect(tooltip.classes()).toContain('block')
      expect(tooltip.classes()).not.toContain('hidden')
    })

    it('hides again when the pointer leaves', async () => {
      const wrapper = mountBadge()
      const badge = wrapper.find('[tabindex="0"]')
      await badge.trigger('mouseenter')
      await badge.trigger('mouseleave')
      expect(wrapper.find('[role="tooltip"]').classes()).toContain('hidden')
    })

    it('opens on focus and closes on blur, so it is reachable by keyboard', async () => {
      const wrapper = mountBadge()
      const badge = wrapper.find('[tabindex="0"]')
      await badge.trigger('focus')
      expect(wrapper.find('[role="tooltip"]').classes()).toContain('block')
      await badge.trigger('blur')
      expect(wrapper.find('[role="tooltip"]').classes()).toContain('hidden')
    })

    it('is wired to the badge through aria-describedby', () => {
      const wrapper = mountBadge()
      const tooltipId = wrapper.find('[role="tooltip"]').attributes('id')
      expect(tooltipId).toBeTruthy()
      expect(wrapper.find('[tabindex="0"]').attributes('aria-describedby')).toBe(tooltipId)
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
