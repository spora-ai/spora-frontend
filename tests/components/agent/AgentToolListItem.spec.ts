import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import AgentToolListItem from '@/components/agent/AgentToolListItem.vue'

const makeTool = (overrides: Record<string, unknown> = {}) => ({
  tool_class: 'Spora\\Tools\\WebSearch',
  tool_name: 'web_search',
  display_name: 'Web Search',
  description: '',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, scope: 'global', options: null },
  ],
  recommends_skills: [] as string[],
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

  describe('per-operation rendering', () => {
    it('renders operator_description when present', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({
            operations: [
              {
                name: 'update_agent',
                description: 'Long LLM-facing prose. Operators do not need this.',
                operator_description: 'Update editable agent fields.',
                enabledByDefault: false,
                requiresApprovalByDefault: true,
              },
            ],
          }),
          enabled: true,
          saving: false,
        },
      })
      expect(wrapper.text()).toContain('Update editable agent fields.')
      expect(wrapper.text()).not.toContain('Long LLM-facing prose.')
    })

    it('falls back to LLM description when operator_description is empty', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({
            operations: [
              {
                name: 'send_email',
                description: 'Send an email.',
                operator_description: '',
                enabledByDefault: true,
                requiresApprovalByDefault: false,
              },
            ],
          }),
          enabled: true,
          saving: false,
        },
      })
      expect(wrapper.text()).toContain('Send an email.')
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
    it('shown when disabled + has schema + canEnable=false (no defaults in cascade)', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false, canEnable: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(true)
    })

    it('hidden when enabled=true', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: true, saving: false, canEnable: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(false)
    })

    it('hidden when tool has no settings_schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool({ settings_schema: [] }), enabled: false, saving: false, canEnable: false },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(false)
    })

    it('hidden when defaults exist in cascade (canEnable=true), even with schema', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false, canEnable: true },
      })
      expect(wrapper.find('[data-testid="set-up-and-enable"]').exists()).toBe(false)
    })

    it('emits setUpAndEnable when clicked', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false, canEnable: false },
      })
      await wrapper.find('[data-testid="set-up-and-enable"]').trigger('click')
      expect(wrapper.emitted('setUpAndEnable')).toBeDefined()
    })
  })

  describe('toggle visibility', () => {
    it('hidden when disabled + schema + canEnable=false (CTA replaces it)', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false, canEnable: false },
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

    it('shown when disabled + schema + defaults exist (canEnable=true)', () => {
      const wrapper = mount(AgentToolListItem, {
        props: { tool: makeTool(), enabled: false, saving: false, canEnable: true },
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

  describe('bundled-skill affordance (PR 2 of recommendsSkills)', () => {
    it('renders nothing when recommendsSkills is empty', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: [] }),
          enabled: false,
          saving: false,
        },
      })
      expect(wrapper.find('[data-testid="bundled-skill-toggle"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="bundled-skill-pill"]').exists()).toBe(false)
    })

    it('renders the Enable-skill button and emits toggleBundledSkills on click', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ tool_name: 'companion', recommends_skills: ['git', 'pdf'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git', 'pdf'],
          bundledSkillsEnabled: false,
          bundledSkillsAvailable: true,
        },
      })
      const button = wrapper.find('[data-testid="bundled-skill-toggle"]')
      expect(button.exists()).toBe(true)
      expect(button.text()).toContain('Enable skill')
      expect(button.attributes('disabled')).toBeUndefined()
      await button.trigger('click')
      expect(wrapper.emitted('toggleBundledSkills')).toBeDefined()
    })

    it('shows the "Recommended" cue alongside the Enable-skill button', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git', 'pdf'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git', 'pdf'],
          bundledSkillsEnabled: false,
          bundledSkillsAvailable: true,
        },
      })
      const cue = wrapper.find('[data-testid="bundled-skill-recommendation"]')
      expect(cue.exists()).toBe(true)
      expect(cue.text()).toContain('Recommended')
      expect(cue.attributes('title')).toContain('git')
      expect(cue.attributes('title')).toContain('pdf')
    })

    it('hides the "Recommended" cue once the bundled skill is enabled', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git'],
          bundledSkillsEnabled: true,
          bundledSkillsAvailable: true,
        },
      })
      expect(wrapper.find('[data-testid="bundled-skill-recommendation"]').exists()).toBe(false)
    })

    it('renders the on-state affordance as a clickable button that emits toggleBundledSkills', async () => {
      // Regression for the "I'd like a toggle for the skill" feedback:
      // the on-state used to be a non-interactive pill, leaving the
      // operator no direct way to disable the bundled skill. The
      // affordance is now a proper two-state toggle.
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git', 'pdf'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git', 'pdf'],
          bundledSkillsEnabled: true,
          bundledSkillsAvailable: true,
        },
      })
      const pill = wrapper.find('[data-testid="bundled-skill-pill"]')
      expect(pill.exists()).toBe(true)
      expect(pill.text()).toContain('Skill enabled')
      expect(pill.attributes('disabled')).toBeUndefined()
      expect(pill.attributes('title')).toContain('Disable')
      expect(pill.attributes('title')).toContain('git')
      await pill.trigger('click')
      expect(wrapper.emitted('toggleBundledSkills')).toBeDefined()
    })

    it('shows the off-state tooltip listing the slugs the click will enable', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library'],
          bundledSkillsEnabled: false,
          bundledSkillsAvailable: true,
        },
      })
      const button = wrapper.find('[data-testid="bundled-skill-toggle"]')
      expect(button.attributes('title')).toContain('Enable')
      expect(button.attributes('title')).toContain('media-library')
    })

    it('renders the green "Skill enabled" pill when bundledSkillsEnabled is true', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ tool_name: 'companion', recommends_skills: ['git'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git'],
          bundledSkillsEnabled: true,
        },
      })
      const pill = wrapper.find('[data-testid="bundled-skill-pill"]')
      expect(pill.exists()).toBe(true)
      expect(pill.text()).toContain('Skill enabled')
      expect(wrapper.find('[data-testid="bundled-skill-toggle"]').exists()).toBe(false)
    })

    it('disables the button with a Skill-not-installed tooltip when the SkillTool is unavailable', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git'],
          bundledSkillsEnabled: false,
          bundledSkillsAvailable: false,
        },
      })
      const button = wrapper.find('[data-testid="bundled-skill-toggle"]')
      expect(button.exists()).toBe(true)
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.attributes('title')).toBe('Skill not installed')
    })

    it('disables the button while a parent toggle or bundled-skill call is in flight', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git'] }),
          enabled: true,
          saving: true,
          recommendsSkills: ['git'],
          bundledSkillsEnabled: false,
          bundledSkillsLoading: false,
        },
      })
      expect(wrapper.find('[data-testid="bundled-skill-toggle"]').attributes('disabled')).toBeDefined()
    })

    it('renders the spinner inside the button when bundledSkillsLoading is true', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['git'],
          bundledSkillsEnabled: false,
          bundledSkillsLoading: true,
        },
      })
      const button = wrapper.find('[data-testid="bundled-skill-toggle"]')
      expect(button.attributes('disabled')).toBeDefined()
      // Spinner is rendered via the loader-2 icon with the animate-spin class.
      expect(button.html()).toContain('animate-spin')
    })
  })
})
