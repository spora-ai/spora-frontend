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
          enabled: true,
          saving: false,
        },
      })
      expect(wrapper.find('[data-testid="bundled-skill-list"]').exists()).toBe(false)
    })

    it('renders nothing when the parent tool is disabled (skills only make sense while the parent is on)', () => {
      // Regression for the "I can enable skills of inactive tools" report.
      // The affordance is gated on `enabled` so it can't be triggered
      // for a tool that is itself off — flipping the parent tool's
      // main toggle cascades a SkillTool disable + slug strip.
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['git', 'pdf'] }),
          enabled: false,
          saving: false,
          recommendsSkills: ['git', 'pdf'],
          enabledSkillSlugs: [],
          bundledSkillsAvailable: true,
        },
      })
      expect(wrapper.find('[data-testid="bundled-skill-list"]').exists()).toBe(false)
    })

    it('renders one row per recommended skill with the formatted name and the raw slug', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library', 'sub-agent'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library', 'sub-agent'],
          enabledSkillSlugs: [],
          bundledSkillsAvailable: true,
        },
      })
      const rows = wrapper.findAll('[data-testid^="bundled-skill-row-"]')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.text()).toContain('Media Library')
      expect(rows[0]!.text()).toContain('media-library')
      expect(rows[1]!.text()).toContain('Sub Agent')
      expect(rows[1]!.text()).toContain('sub-agent')
    })

    it('marks the row toggle on when the slug is in enabledSkillSlugs', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library', 'sub-agent'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library', 'sub-agent'],
          enabledSkillSlugs: ['media-library'],
          bundledSkillsAvailable: true,
        },
      })
      const onSwitch = wrapper.find('[data-testid="bundled-skill-row-media-library"]').find('[role="switch"]')
      const offSwitch = wrapper.find('[data-testid="bundled-skill-row-sub-agent"]').find('[role="switch"]')
      expect(onSwitch.attributes('aria-checked')).toBe('true')
      expect(offSwitch.attributes('aria-checked')).toBe('false')
    })

    it('emits toggleBundledSkill with the slug and value when a row toggle is clicked', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library'],
          enabledSkillSlugs: [],
          bundledSkillsAvailable: true,
        },
      })
      const switchEl = wrapper.find('[data-testid="bundled-skill-row-media-library"]').find('[role="switch"]')
      await switchEl.trigger('click')
      const emitted = wrapper.emitted('toggleBundledSkill')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual([{ slug: 'media-library', value: true }])
    })

    it('emits toggleBundledSkill with value=false when an enabled skill is clicked off', async () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library'],
          enabledSkillSlugs: ['media-library'],
          bundledSkillsAvailable: true,
        },
      })
      const switchEl = wrapper.find('[data-testid="bundled-skill-row-media-library"]').find('[role="switch"]')
      await switchEl.trigger('click')
      const emitted = wrapper.emitted('toggleBundledSkill')
      expect(emitted).toBeDefined()
      expect(emitted![0]).toEqual([{ slug: 'media-library', value: false }])
    })

    it('disables every row toggle with a Skill-not-installed tooltip when SkillTool is unavailable', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library', 'sub-agent'] }),
          enabled: true,
          saving: false,
          recommendsSkills: ['media-library', 'sub-agent'],
          enabledSkillSlugs: [],
          bundledSkillsAvailable: false,
        },
      })
      // Scope to the bundled-skill row — the outer main tool toggle
      // also has [role="switch"] but isn't disabled when enabled=true.
      const rows = wrapper.findAll('[data-testid^="bundled-skill-row-"]')
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        const sw = row.find('[role="switch"]')
        expect(sw.attributes('disabled')).toBeDefined()
        expect(sw.attributes('title')).toBe('Skill not installed')
      }
    })

    it('disables every row toggle while a parent toggle or bundled-skill call is in flight', () => {
      const wrapper = mount(AgentToolListItem, {
        props: {
          tool: makeTool({ recommends_skills: ['media-library'] }),
          enabled: true,
          saving: true,
          recommendsSkills: ['media-library'],
          enabledSkillSlugs: [],
          bundledSkillsAvailable: true,
          bundledSkillsLoading: false,
        },
      })
      expect(wrapper.find('[role="switch"]').attributes('disabled')).toBeDefined()
    })
  })
})
