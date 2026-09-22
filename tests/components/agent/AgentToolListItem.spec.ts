import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import AgentToolListItem from '@/components/agent/AgentToolListItem.vue'

const makeTool = (overrides = {}) => ({
  tool_class: 'Spora\\Tools\\WebSearch',
  tool_name: 'web_search',
  display_name: 'Web Search',
  description: '',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, scope: 'global', options: null },
  ],
  ...overrides,
})

describe('AgentToolListItem', () => {
  describe('renders correctly', () => {
    it('shows tool display_name when available', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ display_name: 'Web Search', tool_name: 'web_search' }),
          enabled: false,
          saving: false,
        },
      })
      expect(wrapper.text()).toContain('Web Search')
    })

    it('falls back to tool_name when display_name is empty', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ display_name: '', tool_name: 'web_search' }),
          enabled: false,
          saving: false,
        },
      })
      expect(wrapper.text()).toContain('web_search')
    })

    it('shows description when present', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ description: 'Search the web' }), enabled: false, saving: false },
      })
      expect(wrapper.text()).toContain('Search the web')
    })

    it('shows "No description provided" fallback when description is empty and no schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ description: '', settings_schema: [] }),
          enabled: false,
          saving: false,
        },
      })
      expect(wrapper.find('[data-testid="no-description-fallback"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('No description provided by this tool.')
    })

    it('does NOT show the fallback when description is present', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ description: 'has desc', settings_schema: [] }),
          enabled: false,
          saving: false,
        },
      })
      expect(wrapper.find('[data-testid="no-description-fallback"]').exists()).toBe(false)
    })
  })

  describe('configure button', () => {
    it('shown when enabled=true and tool has settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false },
      })
      expect(wrapper.find('[data-testid="configure"]').exists()).toBe(true)
    })

    it('hidden when enabled=false', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false },
      })
      expect(wrapper.find('[data-testid="configure"]').exists()).toBe(false)
    })

    it('hidden when tool has no settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [] }), enabled: true, saving: false },
      })
      expect(wrapper.find('[data-testid="configure"]').exists()).toBe(false)
    })
  })

  describe('set up & enable CTA', () => {
    it('shown when enabled=false and tool has settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(true)
    })

    it('hidden when enabled=true', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(false)
    })

    it('hidden when tool has no settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [] }), enabled: false, saving: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(false)
    })

    it('emits setUpAndEnable when clicked', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false },
      })
      await wrapper.find('[data-testid="set-up-and-enable"]').trigger('click')
      expect(wrapper.emitted('setUpAndEnable')).toBeDefined()
    })
  })

  describe('toggle visibility', () => {
    it('hidden when disabled-needs-config (CTA replaces it)', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false },
      })
      const switchEl = wrapper.find('[role="switch"]')
      expect(switchEl.exists()).toBe(false)
    })

    it('shown when enabled regardless of schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false },
      })
      const switchEl = wrapper.find('[role="switch"]')
      expect(switchEl.exists()).toBe(true)
    })

    it('shown when disabled and no schema (toggle works fine)', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [] }), enabled: false, saving: false },
      })
      const switchEl = wrapper.find('[role="switch"]')
      expect(switchEl.exists()).toBe(true)
    })
  })

  describe('credentials hint text', () => {
    it('shows "Has credentials to configure" when enabled and has settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false },
      })
      expect(wrapper.text()).toContain('Has credentials to configure')
    })

    it('shows "Enable to configure credentials" when disabled and has settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false },
      })
      expect(wrapper.text()).toContain('Enable to configure credentials')
    })

    it('shows nothing when tool has no settings_schema and no description', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [], description: '' }), enabled: true, saving: false },
      })
      expect(wrapper.text()).not.toContain('credentials')
    })
  })

  describe('emits', () => {
    it('emits toggle when the switch is flipped', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [] }), enabled: false, saving: false },
      })
      await wrapper.find('[role="switch"]').trigger('click')
      expect(wrapper.emitted('toggle')).toBeDefined()
    })

    it('emits openConfig when configure button clicked', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false },
      })
      await wrapper.find('[data-testid="configure"]').trigger('click')
      expect(wrapper.emitted('openConfig')).toBeDefined()
    })
  })
})
