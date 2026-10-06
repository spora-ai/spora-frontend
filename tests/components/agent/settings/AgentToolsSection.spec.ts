/**
 * AgentToolsSection — tool registry grouped by category + enable/disable.
 *
 * Mocks the agent store, the tool-settings composable, and the api client.
 * Stubs AgentToolListItem (tool row), AgentToolConfigModal (config form),
 * and AgentToolsToolbar (search + filter bar) so the section's filter,
 * enable, and configure-and-enable flows can be tested in isolation.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const agentStoreMock = {
  enableTool: vi.fn(),
  disableTool: vi.fn(),
  getAllOperationOverrides: vi.fn(),
  patchOperationOverride: vi.fn(),
}
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => agentStoreMock,
}))

const toolSettingsMock = {
  getAllToolStatuses: vi.fn(),
  getToolStatus: vi.fn(),
}
vi.mock('@/composables/useToolSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useToolSettings')>()
  return {
    ...actual,
    useToolSettings: () => toolSettingsMock,
  }
})

const bundledSkillsMock = {
  readEffectiveSkills: vi.fn(),
  addSkillsToAllowlist: vi.fn(),
  removeSkillsFromAllowlist: vi.fn(),
}
vi.mock('@/composables/useBundledSkills', () => ({
  useBundledSkills: () => bundledSkillsMock,
}))

import AgentToolsSection from '@/components/agent/settings/AgentToolsSection.vue'
import { api } from '@/api/client'
import type { SkillSummary } from '@/types/skill'

const ListItemStub = {
  name: 'AgentToolListItem',
  props: [
    'tool',
    'enabled',
    'saving',
    'missingRequired',
    'operationStates',
    'canEnable',
    'recommendsSkills',
    'enabledSkillSlugs',
    'bundledSkillsAvailable',
    'bundledSkillsLoading',
  ],
  emits: [
    'toggle',
    'openConfig',
    'setUpAndEnable',
    'toggleOperationEnabled',
    'toggleOperationAutoApprove',
    'toggleBundledSkill',
  ],
  template: `
    <div
      class="tool-item"
      :data-tool-name="tool.tool_name"
      :data-enabled="enabled"
      :data-saving="saving"
      :data-can-enable="canEnable"
      :data-bundled-available="bundledSkillsAvailable"
      :data-bundled-loading="bundledSkillsLoading"
    >
      <button v-if="canEnable !== false || !tool.settings_schema || tool.settings_schema.length === 0" class="toggle" @click="$emit('toggle')">Toggle</button>
      <button v-if="canEnable === false && tool.settings_schema && tool.settings_schema.length > 0" class="setup-enable" data-testid="set-up-and-enable" @click="$emit('setUpAndEnable')">Set up & enable</button>
      <button class="config" @click="$emit('openConfig')">Config</button>
      <button class="op-enabled" @click="$emit('toggleOperationEnabled', 'op1')">Op1</button>
      <button class="op-auto" @click="$emit('toggleOperationAutoApprove', 'op1')">OpAuto</button>
      <button
        v-for="slug in recommendsSkills"
        :key="slug"
        class="bundled-stub"
        :data-bundled-slug="slug"
        :data-bundled-on="enabledSkillSlugs && enabledSkillSlugs.includes(slug)"
        data-testid="bundled-toggle-stub"
        @click="$emit('toggleBundledSkill', { slug, value: !(enabledSkillSlugs && enabledSkillSlugs.includes(slug)) })"
      >Toggle {{ slug }}</button>
    </div>
  `,
}
const ConfigModalStub = {
  name: 'AgentToolConfigModal',
  props: ['toolName', 'tool', 'agentId'],
  emits: ['saved', 'close'],
  // The real modal emits `saved` AND `close` in the same tick after a
  // successful save (see AgentToolConfigModal.vue:93-94). The stub must
  // mirror that so the test catches the race where @close resets the
  // pending flag before onToolSaved's async auto-enable can read it.
  template: '<div v-if="toolName" class="config-modal-stub"><button class="save-btn" @click="$emit(\'saved\', toolName); $emit(\'close\')">Save</button></div>',
}
const ToolbarStub = {
  name: 'AgentToolsToolbar',
  props: ['categories', 'statusCounts', 'search', 'status', 'selected'],
  emits: ['update:search', 'update:status', 'update:selected'],
  template: '<div class="toolbar-stub" :data-status="status"></div>',
}

const baseAgent = { id: 1, tools: [] }
const baseRegistry = [
  { tool_class: 'Spora\\Tools\\Skill', tool_name: 'skill', display_name: 'Skill Tool', description: 'Manage skills', category: 'utility', settings_schema: [] },
  { tool_class: 'Spora\\Tools\\WebSearch', tool_name: 'web_search', display_name: 'Web Search', description: 'Search the web', category: 'web', settings_schema: [] },
  { tool_class: 'Spora\\Tools\\Email', tool_name: 'send_email', display_name: 'Send Email', description: 'Send an email', category: 'communication', settings_schema: [] },
  { tool_class: 'Spora\\Tools\\Time', tool_name: 'time', display_name: 'Time', description: 'Tell the time', category: 'utility', settings_schema: [], operations: [{ name: 'now', description: 'Current time', operator_description: 'Current time', enabledByDefault: true, requiresApprovalByDefault: false }] },
  // Real-world shape: some plugins ship with undefined description / operations.
  { tool_class: 'Spora\\Tools\\Sparse', tool_name: 'sparse', display_name: 'Sparse Tool', description: undefined, category: 'utility', settings_schema: [], operations: undefined },
  // Tool with a schema — used by the Set up & enable CTA tests.
  {
    tool_class: 'Spora\\Tools\\Serper',
    tool_name: 'serper',
    display_name: 'Serper Search',
    description: 'Google search via Serper.dev',
    category: 'search',
    settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: true, scope: 'global', options: null }],
  },
  // Tool whose recommended skill is unique to it — exercises the confirm
  // dialog when this tool is disabled alone.
  {
    tool_class: 'Spora\\Tools\\Companion',
    tool_name: 'companion',
    display_name: 'Companion',
    description: 'A companion tool',
    category: 'productivity',
    settings_schema: [],
    recommends_skills: ['only-companion'],
  },
  // Independent tool — never shares slugs with companion; used to keep
  // `only-companion` unique so the dialog test path is exercisable.
  {
    tool_class: 'Spora\\Tools\\Mirror',
    tool_name: 'mirror',
    display_name: 'Mirror',
    description: 'A mirror tool',
    category: 'productivity',
    settings_schema: [],
    recommends_skills: ['only-mirror'],
  },
  // Independent tool — never shares slugs with companion; partner
  // exists only to verify the base registry stays diverse and that
  // unrelated tools do not leak into the share filter.
  {
    tool_class: 'Spora\\Tools\\Partner',
    tool_name: 'partner',
    display_name: 'Partner',
    description: 'A partner tool',
    category: 'productivity',
    settings_schema: [],
    recommends_skills: ['only-partner'],
  },
]

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockResolvedValue({ tools: baseRegistry })
  agentStoreMock.enableTool.mockReset()
  agentStoreMock.enableTool.mockResolvedValue(undefined)
  agentStoreMock.disableTool.mockReset()
  agentStoreMock.disableTool.mockResolvedValue(undefined)
  agentStoreMock.getAllOperationOverrides.mockReset()
  agentStoreMock.getAllOperationOverrides.mockResolvedValue({})
  agentStoreMock.patchOperationOverride.mockReset()
  agentStoreMock.patchOperationOverride.mockResolvedValue(undefined)
  toolSettingsMock.getAllToolStatuses.mockReset()
  toolSettingsMock.getAllToolStatuses.mockResolvedValue({})
  toolSettingsMock.getToolStatus.mockReset()
  toolSettingsMock.getToolStatus.mockResolvedValue(null)
  bundledSkillsMock.readEffectiveSkills.mockReset()
  bundledSkillsMock.readEffectiveSkills.mockResolvedValue([])
  bundledSkillsMock.addSkillsToAllowlist.mockReset()
  bundledSkillsMock.addSkillsToAllowlist.mockResolvedValue(undefined)
  bundledSkillsMock.removeSkillsFromAllowlist.mockReset()
  bundledSkillsMock.removeSkillsFromAllowlist.mockResolvedValue(undefined)
})

function mountSection(overrides = {}) {
  return mount(AgentToolsSection, {
    props: { agent: baseAgent, agentId: 1, ...overrides },
    global: {
      stubs: {
        AgentToolListItem: ListItemStub,
        AgentToolConfigModal: ConfigModalStub,
        AgentToolsToolbar: ToolbarStub,
      },
    },
  })
}

describe('AgentToolsSection', () => {
  it('loads tools and renders them grouped by category', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(9)
    expect(wrapper.text()).toContain('Web')
    expect(wrapper.text()).toContain('Communication')
    expect(wrapper.text()).toContain('Utility')
  })

  it('shows "No tools registered" when registry is empty', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ tools: [] })
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.text()).toContain('No tools registered')
  })

  it('disables a tool when the user toggles an enabled tool', async () => {
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    const item = wrapper.find('[data-tool-name="web_search"]')
    expect(item.attributes('data-enabled')).toBe('true')
    await item.find('.toggle').trigger('click')
    await flushPromises()
    expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'web_search')
    expect(item.attributes('data-enabled')).toBe('false')
  })

  it('opens the config modal directly when Set up & enable is clicked on a tool with no defaults', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="serper"]').find('.setup-enable').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
  })

  it('shows the toggle (not Set up & enable) when defaults exist at cascade level', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: false, can_enable: true, missing_required: [] },
    })
    const wrapper = mountSection()
    await flushPromises()
    const item = wrapper.find('[data-tool-name="web_search"]')
    expect(item.find('.setup-enable').exists()).toBe(false)
    expect(item.find('.toggle').exists()).toBe(true)
    await item.find('.toggle').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'web_search')
  })

  it('surfaces an error message on toggle failure', async () => {
    const { ApiError } = await import('@/api/client')
    agentStoreMock.disableTool.mockRejectedValueOnce(new ApiError('nope'))
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('nope')
  })

  it('opens the config modal when openConfig is emitted', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.config').trigger('click')
    await flushPromises()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
  })

  it('refreshes the tool status after the config modal emits "saved"', async () => {
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: true, can_enable: true, missing_required: [] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.config').trigger('click')
    await flushPromises()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(toolSettingsMock.getToolStatus).toHaveBeenCalledWith('web_search')
  })

  it('enables a tool when toggle is pressed on a can_enable=true tool', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: false, can_enable: true, missing_required: [] },
    })
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: true, can_enable: true, missing_required: [] })
    const wrapper = mountSection()
    await flushPromises()
    const item = wrapper.find('[data-tool-name="web_search"]')
    expect(item.attributes('data-enabled')).toBe('false')
    await item.find('.toggle').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'web_search')
    expect(item.attributes('data-enabled')).toBe('true')
  })

  it('opens the config modal directly when re-fetched status reports can_enable=false', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: true, missing_required: [] },
    })
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: false, can_enable: false, missing_required: ['api_key'] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="serper"]').find('.toggle').trigger('click')
    await flushPromises()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
  })

  it('falls back to a generic error message when toggle fails with a non-ApiError', async () => {
    agentStoreMock.disableTool.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('Failed to update tool.')
  })

  it('toggles an operation enabled flag and stores the override', async () => {
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.op-enabled').trigger('click')
    await flushPromises()
    expect(agentStoreMock.patchOperationOverride).toHaveBeenCalledWith(1, 'web_search', 'op1', { enabled: true })
  })

  it('restores the previous operation state on patch failure', async () => {
    const { ApiError } = await import('@/api/client')
    agentStoreMock.patchOperationOverride.mockRejectedValueOnce(new ApiError('denied'))
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.op-enabled').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('denied')
  })

  it('falls back to a generic error on operation patch failure when not an ApiError', async () => {
    agentStoreMock.patchOperationOverride.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.op-enabled').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('Failed to update operation.')
  })

  it('toggles an operation auto-approve flag and stores the override', async () => {
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.op-auto').trigger('click')
    await flushPromises()
    expect(agentStoreMock.patchOperationOverride).toHaveBeenCalledWith(1, 'web_search', 'op1', { default_requires_approval: false })
  })

  it('falls back to a generic error on auto-approve patch failure when not an ApiError', async () => {
    agentStoreMock.patchOperationOverride.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.op-auto').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('Failed to update operation auto-approve.')
  })

  it('items are visible by default (no collapsing on mount)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.findAll('.tool-item').length).toBe(9)
  })

  it('shows "No tools match the current filters" when filters exclude all', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'zzzzzz')
    await flushPromises()
    expect(wrapper.findAll('.tool-item').length).toBe(0)
    expect(wrapper.find('[data-testid="no-results"]').exists()).toBe(true)
  })

  it('filters tools by search query (matches display_name)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'email')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('send_email')
  })

  it('does not throw on tools with undefined description and operations (regression)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'sparse')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items.map((i) => i.attributes('data-tool-name'))).toContain('sparse')
  })

  it('filters tools by search query (matches description)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'tell the time')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('time')
  })

  it('filters tools by search query (matches operation name)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'now')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('time')
  })

  it('filters tools by status (enabled only)', async () => {
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }, { tool_name: 'send_email' }] } })
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'enabled')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.attributes('data-enabled') === 'true')).toBe(true)
  })

  it('filters tools by status (off only)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'off')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(9)
    expect(items.every((i) => i.attributes('data-enabled') === 'false')).toBe(true)
  })

  it('filters tools by status (needs-setup when enabled with missing_required)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: true, can_enable: true, missing_required: ['api_key'] },
    })
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'needs-setup')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('web_search')
  })

  it('filters tools by status (needs-setup when disabled with no cascade defaults — CTA scenario)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'needs-setup')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('serper')
  })

  it('does NOT put schema-less disabled tools in needs-setup even when can_enable=false (data sanity)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      sparse: { is_enabled: false, can_enable: false, missing_required: ['bogus'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'needs-setup')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(0)
  })

  it('keeps disabled tools with cascade defaults under "off" (not "needs-setup")', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: true, missing_required: [] },
    })
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:status', 'off')
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(9)
    expect(items.map((i) => i.attributes('data-tool-name'))).toContain('serper')
  })

  it('filters tools by category (multi-select)', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:selected', new Set<string>(['web']))
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('web_search')
  })

  it('composes search + status + category filters', async () => {
    const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }, { tool_name: 'send_email' }] } })
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'email')
    await toolbar.vm.$emit('update:status', 'enabled')
    await toolbar.vm.$emit('update:selected', new Set<string>(['communication']))
    await flushPromises()
    const items = wrapper.findAll('.tool-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-tool-name')).toBe('send_email')
  })

  it('drops empty category groups when filters exclude all tools in them', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:selected', new Set<string>(['web']))
    await flushPromises()
    expect(wrapper.text()).toContain('Web')
    expect(wrapper.text()).not.toContain('Communication')
    expect(wrapper.text()).not.toContain('Utility')
  })

  it('shows compact result-count footer "Showing N of M"', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const footer = wrapper.find('[data-testid="result-count"]')
    expect(footer.exists()).toBe(true)
    expect(footer.text()).toBe('Showing 9 of 9')
  })

  it('updates result-count footer reactively when filters narrow the list', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'email')
    await flushPromises()
    expect(wrapper.find('[data-testid="result-count"]').text()).toBe('Showing 1 of 9')
  })

  it('opens config modal directly when Set up & enable CTA is clicked (no enable call yet)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="serper"]').find('.setup-enable').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
  })

  it('auto-enables the tool after config modal saves when Set up & enable was used (regression for configure-then-off bug)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    toolSettingsMock.getToolStatus
      .mockResolvedValueOnce({ is_enabled: false, can_enable: true, missing_required: [] })
      .mockResolvedValueOnce({ is_enabled: true, can_enable: true, missing_required: [] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="serper"]').find('.setup-enable').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'serper')
    expect(wrapper.find('[data-tool-name="serper"]').attributes('data-enabled')).toBe('true')
  })

  it('does NOT auto-enable after config save when pendingEnableAfterConfig is null (regular re-edit)', async () => {
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: true, can_enable: true, missing_required: [] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.config').trigger('click')
    await flushPromises()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
  })

  it('surfaces an error when auto-enable after save fails', async () => {
    const { ApiError } = await import('@/api/client')
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      serper: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: false, can_enable: true, missing_required: [] })
    agentStoreMock.enableTool.mockRejectedValueOnce(new ApiError('enable failed'))
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="serper"]').find('.setup-enable').trigger('click')
    await flushPromises()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('enable failed')
  })

  describe('bundled-skill affordance (PR 2 of recommendsSkills)', () => {
    it('fetches the SkillTool allowlist on mount when the skill tool is enabled', async () => {
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(bundledSkillsMock.readEffectiveSkills).toHaveBeenCalled()
    })

    it('skips the allowlist fetch when the SkillTool is not registered (defensive)', async () => {
      vi.mocked(api.get).mockReset()
      vi.mocked(api.get).mockResolvedValue({
        tools: [
          { tool_class: 'X', tool_name: 'web_search', display_name: 'Web', description: '', category: 'web', settings_schema: [], recommends_skills: [] },
        ],
      })
      mountSection()
      await flushPromises()
      expect(bundledSkillsMock.readEffectiveSkills).not.toHaveBeenCalled()
    })

    it('toggleBundledSkill (off→on) enables SkillTool then adds just the one slug', async () => {
      // Per-skill toggle: click on the row for `only-companion` and
      // only that slug is added (other recommended slugs, if any, are
      // left to the operator). Regression for the "use the toggle
      // buttons we have everywhere else" iteration.
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue([])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"][data-bundled-slug="only-companion"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'skill')
      expect(bundledSkillsMock.addSkillsToAllowlist).toHaveBeenCalledWith(['only-companion'])
    })

    it('toggleBundledSkill (off→on) re-fetches SkillTool status so the SkillTool card stops showing "missing config"', async () => {
      // The SkillTool's status map entry is stale (missing_required for
      // allowed_skills) at the moment the bundled-skill toggle fires.
      // After writing the per-agent override, the section re-fetches
      // SkillTool's status so the "credentials to configure" badge on
      // the SkillTool card clears. Regression for the "Skill tool shows
      // there are credentials to configure" report.
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue([])
      toolSettingsMock.getToolStatus.mockResolvedValueOnce({
        is_enabled: true,
        can_enable: true,
        missing_required: [],
      })
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"][data-bundled-slug="only-companion"]').trigger('click')
      await flushPromises()
      const skillCalls = (toolSettingsMock.getToolStatus.mock.calls as unknown[][])
        .filter((c) => c[0] === 'skill')
      expect(skillCalls.length).toBeGreaterThanOrEqual(2)
    })

    it('toggleBundledSkill (on→off) removes just that one slug and leaves SkillTool alone', async () => {
      // Per-skill toggle off: only the slug for the row the operator
      // clicked is removed. SkillTool stays on because the operator
      // didn't ask for it to be disabled — they may want the other
      // bundled skills (or sibling tools' skills) to keep working.
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['only-companion'])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"][data-bundled-slug="only-companion"]').trigger('click')
      await flushPromises()
      expect(bundledSkillsMock.removeSkillsFromAllowlist).toHaveBeenCalledWith(['only-companion'])
      expect(agentStoreMock.disableTool).not.toHaveBeenCalledWith(1, 'skill')
    })

    it('toggleBundledSkill (on→off) leaves SkillTool alone even when the toggled slug was the only one in the allowlist', async () => {
      // Explicit regression for the "you disabled the whole skill tool
      // when only one bundled skill should be deactivated" report. The
      // operator had ONE bundled skill active and toggled it off —
      // SkillTool must stay enabled. The parent-tool disable cascade
      // is the only path that disables SkillTool, and only when the
      // operator explicitly turns off the parent tool.
      bundledSkillsMock.readEffectiveSkills.mockResolvedValueOnce(['only-companion'])
      bundledSkillsMock.removeSkillsFromAllowlist.mockResolvedValueOnce(undefined)
      bundledSkillsMock.readEffectiveSkills.mockResolvedValueOnce([])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"][data-bundled-slug="only-companion"]').trigger('click')
      await flushPromises()
      expect(bundledSkillsMock.removeSkillsFromAllowlist).toHaveBeenCalledWith(['only-companion'])
      const skillDisableCalls = (agentStoreMock.disableTool.mock.calls as unknown[][])
        .filter((c) => c[1] === 'skill')
      expect(skillDisableCalls).toHaveLength(0)
    })

    it('toggleTool on a tool with unique recommended slugs strips the slugs but leaves SkillTool enabled', async () => {
      // Disabling the parent tool removes its unique slugs from
      // SkillTool's allowlist. SkillTool itself stays enabled — the
      // operator manages it via its own card / per-skill toggles,
      // and "you disabled the whole skill tool when only one bundled
      // skill should be deactivated" was the explicit regression
      // here. We rather leave it on (empty allowlist is a valid
      // ready state) than guess at the operator's intent.
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'companion')
      expect(bundledSkillsMock.removeSkillsFromAllowlist).toHaveBeenCalledWith(['only-companion'])
      // SkillTool stays enabled — the parent cascade only strips
      // slugs, never disables the shared SkillTool.
      const skillDisableCalls = (agentStoreMock.disableTool.mock.calls as unknown[][])
        .filter((c) => c[1] === 'skill')
      expect(skillDisableCalls).toHaveLength(0)
    })

    it('toggleTool on a tool with shared recommended slugs strips nothing (the other tool still owns them)', async () => {
      vi.mocked(api.get).mockReset()
      vi.mocked(api.get).mockResolvedValueOnce({
        tools: [
          { tool_class: 'X', tool_name: 'a', display_name: 'A', description: '', category: 'utility', settings_schema: [], recommends_skills: ['shared-skill'] },
          { tool_class: 'Y', tool_name: 'b', display_name: 'B', description: '', category: 'utility', settings_schema: [], recommends_skills: ['shared-skill'] },
        ],
      })
      // Second mount request (the skills list behind the declared-tools
      // banner) — `mockReset` dropped the default implementation, so it
      // has to be queued explicitly. Unwrapped, like the mock above: a
      // re-wrap here would agree with the very bug it should catch.
      vi.mocked(api.get).mockResolvedValueOnce({ skills: [] })
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'a' }, { tool_name: 'b' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="a"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'a')
      // `shared-skill` is also recommended by `b`, so the unique-slug
      // filter strips it out — nothing to remove, SkillTool stays on.
      expect(bundledSkillsMock.removeSkillsFromAllowlist).not.toHaveBeenCalled()
      const skillDisableCalls = (agentStoreMock.disableTool.mock.calls as unknown[][])
        .filter((c) => c[1] === 'skill')
      expect(skillDisableCalls).toHaveLength(0)
    })
  })

  // Tools that skills declare via `allowed-tools` but that are not ready
  // on this agent. The declaration informs; nothing is pre-approved and
  // no call is refused, so the block only appears when something is
  // missing and never claims a tool is blocked.
  describe('skill-declared-tools banner', () => {
    let skills: unknown[]

    // The banner joins three sources — the SkillTool allowlist, the
    // skills list, and the per-agent tool statuses. Routing the mock by
    // path keeps each test to the one source it is about; the other two
    // answer with the ordinary registry / empty status map.
    beforeEach(() => {
      skills = []
      vi.mocked(api.get).mockReset()
      // Unwrapped, deliberately. `api/client.ts` strips core's `{data: …}`
      // envelope before the caller sees it, so a mock that re-wraps agrees with
      // the very bug it should catch — which is what happened: the mock returned
      // `{data: {skills}}`, the component read `.data.skills`, the suite passed,
      // and the banner rendered nothing in a browser. When mocking `api.get`,
      // return what `request()` returns, not what the server sends.
      vi.mocked(api.get).mockImplementation(async (path: string) =>
        path.startsWith('/skills') ? { skills } : { tools: baseRegistry },
      )
    })

    // Every `/skills` request the component made, whatever query string it
    // narrowed by. Matching on a prefix keeps these assertions honest about
    // the `?principal_id=` narrowing.
    function skillsRequests(): unknown[][] {
      return (vi.mocked(api.get).mock.calls as unknown[][])
        .filter((c) => typeof c[0] === 'string' && (c[0] as string).startsWith('/skills'))
    }

    function skillsPaths(): string[] {
      return skillsRequests().map((c) => c[0] as string)
    }

    function skillSummary(overrides: Partial<SkillSummary> & { slug: string }): SkillSummary {
      return {
        name: overrides.slug,
        description: '',
        source: 'core',
        license: null,
        files_count: 1,
        has_warnings: false,
        slug: overrides.slug,
        required_tools: [],
        ...overrides,
      }
    }

    it('renders nothing when every declared tool is already activated', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: true, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid^="skill-declared-tool-row-"]')).toHaveLength(0)
    })

    it('renders nothing when the agent has no SkillTool at all', async () => {
      // No skill tool means no allowlist to read, so no enabled skills and
      // nothing a skill could declare against.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'web_search' }] } })
      await flushPromises()
      expect(bundledSkillsMock.readEffectiveSkills).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })

    it('renders nothing when the SkillTool allowlist is empty', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue([])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })

    it('reads as a warning, not as a caption', async () => {
      // An 11px muted label above a list of tool names is metadata, not a
      // warning: an operator has no way to know it is a problem, wants
      // action, or should care. Amber surface + a warning glyph is the fix,
      // and each part is asserted separately because any one of them alone
      // reads as decoration.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const banner = wrapper.get('[data-testid="skill-declared-tools"]')
      expect(banner.classes()).toContain('border-amber-200')
      expect(banner.classes()).toContain('bg-amber-50')
      expect(banner.find('[data-test="skill-declared-tools-warning-icon"]').exists()).toBe(true)

      // No ARIA role on the block. `role="status"` implies an atomic live
      // region, which would make the subtree — the enable toggles included —
      // a single announcement payload, and Sonar's Web:S6819 rejects it.
      expect(banner.attributes('role')).toBeUndefined()
      // The toggles stay inside the block, so this is a real constraint and
      // not a vacuous one.
      expect(banner.findAll('[data-testid="skill-declared-tool-enable"]').length).toBeGreaterThan(0)
    })

    it('announces the heading politely, and nothing else in the banner', async () => {
      // The banner appears and disappears as tools are toggled, so without
      // a live region the warning is silent to a screen reader. The region
      // goes on the heading alone: it holds text only, so the enable toggles
      // are not swept into the announcement payload, and it is the one node
      // whose content changes while the banner is up.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const banner = wrapper.get('[data-testid="skill-declared-tools"]')
      // The block itself is not a live region: it is re-created with the
      // banner, so a region here would announce a freshly inserted node.
      expect(banner.attributes('aria-live')).toBeUndefined()
      expect(banner.attributes('role')).toBeUndefined()

      const heading = banner.get('p[aria-live="polite"]')
      expect(heading.text()).toBe("1 tool this agent's skills call isn't ready")
      // Exactly one live region in the banner, and it wraps no control.
      expect(banner.findAll('[aria-live]')).toHaveLength(1)
      expect(heading.find('button, [role="switch"], a').exists()).toBe(false)
    })

    it('re-reads the count as a polite announcement when the gap list changes', async () => {
      // `aria-live` without `role="status"` means no implicit atomicity, so
      // the announcement depends on the heading's text actually being
      // replaced — which is what the computed count does on a toggle.
      skills = [skillSummary({
        slug: 'media-library',
        required_tools: ['web_search', 'serper'],
      })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
        serper: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const heading = '[data-testid="skill-declared-tools"] p[aria-live="polite"]'
      expect(wrapper.get(heading).text()).toBe("2 tools this agent's skills call aren't ready")

      // Server confirms the write, so the enabled tool leaves the banner and
      // the heading — the live region — re-reads as one.
      toolSettingsMock.getToolStatus.mockResolvedValue({
        is_enabled: true, can_enable: true, missing_required: [],
      })
      await wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
        .find('[data-testid="skill-declared-tool-enable"]').trigger('click')
      await flushPromises()
      expect(wrapper.get(heading).text()).toBe("1 tool this agent's skills call isn't ready")
    })

    it('renders a non-interactive note, not a disabled switch, for a missing plugin', async () => {
      // No registry entry means no plugin provides the tool here, so there
      // is nothing for the operator to choose. A permanently-disabled
      // `role="switch"` announces as "off, unavailable" — a setting that
      // exists and is refused — and a `disabled` button is not focusable,
      // so its `title` reached nobody but a mouse. The row text carries the
      // reason instead.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['weather_lookup'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const row = wrapper.get('[data-testid="skill-declared-tool-row-weather_lookup"]')
      expect(row.text()).toContain('Plugin not installed')

      const note = row.get('[data-testid="skill-declared-tool-unavailable"]')
      expect(note.element.tagName).toBe('SPAN')
      expect(note.attributes('role')).toBeUndefined()
      expect(note.attributes('aria-disabled')).toBeUndefined()
      expect(note.attributes('disabled')).toBeUndefined()
      expect(note.attributes('tabindex')).toBeUndefined()
      // No focusable anything in the row's action slot.
      expect(row.find('button, a[href], input, [tabindex]').exists()).toBe(false)
    })

    it('counts the gaps in the heading, singular for one', async () => {
      // "Tools these skills use" read the same whether one tool or nine were
      // missing, so a small nudge looked identical to a broken toolset.
      skills = [skillSummary({
        slug: 'media-library',
        required_tools: ['web_search', 'serper', 'weather_lookup'],
      })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
        serper: { is_enabled: false, can_enable: true, missing_required: [] },
        weather_lookup: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.get('[data-testid="skill-declared-tools"]').text())
        .toContain("3 tools this agent's skills call aren't ready")
      expect(wrapper.get('[data-testid="skill-declared-tools"]').text())
        .not.toContain('1 tool ')
    })

    it('says one is not ready, without the plural s', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.get('[data-testid="skill-declared-tools"]').text())
        .toContain("1 tool this agent's skills call isn't ready")
    })

    it('never says "these skills" — the demonstrative has no antecedent on screen', async () => {
      // The allowlist is a column of checkboxes on the SkillTool row further
      // down, not a list called "these". The banner has to name its own
      // subject.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const text = wrapper.get('[data-testid="skill-declared-tools"]').text()
      expect(text).not.toContain('these skills')
      expect(text).not.toContain('Skills you activated')
    })

    it('names the skill that declares each tool, on its own row', async () => {
      // The attribution the heading used to gesture at. "Who wants this?" is
      // the question the row raises, and the answer differs per row.
      skills = [
        skillSummary({ name: 'Media Library', slug: 'media-library', required_tools: ['web_search'] }),
        skillSummary({ name: 'Schedule', slug: 'schedule', required_tools: ['web_search'] }),
      ]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library', 'schedule'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      // One row, because the tool is the same — but both declaring skills,
      // since either one may be the reason an operator cares.
      expect(wrapper.findAll('[data-testid^="skill-declared-tool-row-"]')).toHaveLength(1)
      expect(wrapper.get('[data-testid="skill-declared-tool-skills-web_search"]').text())
        .toBe('Declared by Media Library, Schedule')
    })

    it('lists each declaring skill once, even when two skills declare the same tool twice', async () => {
      skills = [
        skillSummary({ name: 'Media Library', slug: 'media-library', required_tools: ['web_search', 'web_search'] }),
        skillSummary({ name: 'Media Library', slug: 'media-library', required_tools: ['web_search'] }),
      ]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      expect(wrapper.get('[data-testid="skill-declared-tool-skills-web_search"]').text())
        .toBe('Declared by Media Library')
    })

    it('falls back to the slug when a skill has no display name', async () => {
      skills = [skillSummary({ name: '', slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      expect(wrapper.get('[data-testid="skill-declared-tool-skills-web_search"]').text())
        .toBe('Declared by media-library')
    })

    it('reassures that nothing is blocked, inside the warning', async () => {
      // Load-bearing, and in tension with the amber box: `allowed-tools` is a
      // declaration, not a grant, so no call is refused on a skill's behalf and
      // no agent is broken. Without this sentence the warning reads as breakage
      // and an operator may disable skills that were working fine.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const text = wrapper.get('[data-testid="skill-declared-tools"]').text()
      expect(text).toContain('Nothing is blocked')
      expect(text).toContain('a skill only declares what it expects to use')
    })

    it('points at where the tools can be turned on', async () => {
      // The row toggles are a shortcut, not the only route — the operator may
      // already be looking at the tool list further down, or prefer to enable
      // there. Saying so beats making the warning look like a dead end.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      const text = wrapper.get('[data-testid="skill-declared-tools"]').text()
      expect(text).toContain('Turn them on below')
      expect(text).toContain('tool list further down')
    })

    it('renders one row per declared tool, labelled by state and using display names', async () => {
      // `name` deliberately differs from `slug` — the allowlist stores
      // slugs, so joining on `name` would find nothing here.
      skills = [skillSummary({
        name: 'Media Library',
        slug: 'media-library',
        required_tools: ['web_search', 'serper', 'weather_lookup'],
      })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
        // On, yet the cascade leaves `api_key` unset: the tool still
        // cannot run, so an enable toggle would be a dead end.
        serper: { is_enabled: true, can_enable: false, missing_required: ['api_key'] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(true)
      const rows = wrapper.findAll('[data-testid^="skill-declared-tool-row-"]')
      expect(rows.map((r) => r.attributes('data-testid'))).toEqual([
        'skill-declared-tool-row-web_search',
        'skill-declared-tool-row-serper',
        'skill-declared-tool-row-weather_lookup',
      ])

      const off = wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
      expect(off.text()).toContain('Web Search')
      expect(off.text()).toContain('Not on this agent')
      const offToggle = off.find('[data-testid="skill-declared-tool-enable"]')
      expect(offToggle.exists()).toBe(true)
      expect(offToggle.attributes('disabled')).toBeUndefined()
      expect(offToggle.attributes('title')).toBe('Enable Web Search on this agent')

      const unconfigured = wrapper.find('[data-testid="skill-declared-tool-row-serper"]')
      expect(unconfigured.text()).toContain('Serper Search')
      expect(unconfigured.text()).toContain('On, but its settings are not set up')
      expect(unconfigured.find('[data-testid="skill-declared-tool-setup"]').exists()).toBe(true)
      expect(unconfigured.find('[data-testid="skill-declared-tool-enable"]').exists()).toBe(false)

      const missing = wrapper.find('[data-testid="skill-declared-tool-row-weather_lookup"]')
      // No registry entry, so the declared name is all there is to show.
      expect(missing.text()).toContain('weather_lookup')
      expect(missing.text()).toContain('Plugin not installed')
      expect(missing.find('[data-testid="skill-declared-tool-enable"]').exists()).toBe(false)
      expect(missing.find('[data-testid="skill-declared-tool-setup"]').exists()).toBe(false)
      // A note, not a disabled control — see the dedicated test below. The
      // row text already carries the reason, so nothing interactive goes here.
      const missingNote = missing.get('[data-testid="skill-declared-tool-unavailable"]')
      expect(missingNote.element.tagName).toBe('SPAN')
      expect(missingNote.attributes('role')).toBeUndefined()
      expect(missingNote.attributes('aria-disabled')).toBeUndefined()
      expect(missingNote.attributes('disabled')).toBeUndefined()

      // One skills request for the whole banner, not one per declared tool.
      expect(skillsRequests()).toHaveLength(1)
    })

    it('brings the banner back when the tool is switched off again', async () => {
      // The round trip. Enabling cleared the warning correctly because the
      // enable branch refetches `toolStatusMap`; disabling never did, so the
      // stale `is_enabled: true` kept the gap suppressed and the banner stayed
      // gone until a page reload — the operator's report, exactly.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      // Server answers the post-write refetch: off after the disable.
      toolSettingsMock.getToolStatus.mockResolvedValue({
        is_enabled: false, can_enable: true, missing_required: [],
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(true)

      // On → warning gone.
      toolSettingsMock.getToolStatus.mockResolvedValueOnce({
        is_enabled: true, can_enable: true, missing_required: [],
      })
      await wrapper.find('[data-testid="skill-declared-tool-enable"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'web_search')
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)

      // Off again → warning must return, without a reload. The banner is
      // gone at this point, so the disable has to come from the tool's own
      // row in the list below — which is also how an operator would do it.
      await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'web_search')
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="skill-declared-tool-row-web_search"]').exists()).toBe(true)
    })

    it('shows the warning back when the status refetch after a disable fails', async () => {
      // `getToolStatus` returns null on a swallowed failure. Leaving the
      // pre-disable snapshot in place would suppress the banner exactly as the
      // bug did, so the local flip is the fallback — we know we just disabled
      // it, and that is a fact rather than a guess.
      //
      // Starts *enabled*, because that is the only state in which the fallback
      // is reachable: the refetch has to be asked for and has to come back
      // empty while the map still holds a stale `is_enabled: true`.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: true, can_enable: true, missing_required: [] },
      })
      toolSettingsMock.getToolStatus.mockResolvedValue(null)
      // `web_search` has to be in the agent's own tool list, not just enabled
      // in the status map: `toggleTool` branches on `enabledToolNames`, which is
      // built from `agent.tools`. An agent holding a tool the status map calls
      // enabled but its list omits is not a state the server produces.
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'skill' }, { tool_name: 'web_search' }] },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)

      await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
      await flushPromises()

      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'web_search')
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="skill-declared-tool-row-web_search"]').exists()).toBe(true)
    })

    it('enables a declared tool from the banner and disables only the row being saved', async () => {
      skills = [
        skillSummary({ slug: 'media-library', required_tools: ['web_search'] }),
        skillSummary({ slug: 'news-digest', required_tools: ['send_email'] }),
      ]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library', 'news-digest'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
        send_email: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      let releaseEnable: () => void = () => {}
      agentStoreMock.enableTool.mockImplementationOnce(
        () => new Promise<void>((resolve) => { releaseEnable = resolve }),
      )
      toolSettingsMock.getToolStatus.mockResolvedValue({
        is_enabled: true, can_enable: true, missing_required: [],
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      await wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
        .find('[data-testid="skill-declared-tool-enable"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'web_search')
      const touched = wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
        .find('[data-testid="skill-declared-tool-enable"]')
      const untouched = wrapper.find('[data-testid="skill-declared-tool-row-send_email"]')
        .find('[data-testid="skill-declared-tool-enable"]')
      expect(touched.attributes('disabled')).toBeDefined()
      expect(untouched.attributes('disabled')).toBeUndefined()

      releaseEnable()
      await flushPromises()
      // The tool is ready now, so it drops out of the banner.
      expect(wrapper.find('[data-testid="skill-declared-tool-row-web_search"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="skill-declared-tool-row-send_email"]').exists()).toBe(true)
    })

    it('routes the unconfigured row to the config modal instead of enabling', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: ['serper'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        serper: { is_enabled: true, can_enable: false, missing_required: ['api_key'] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      await wrapper.find('[data-testid="skill-declared-tool-row-serper"]')
        .find('[data-testid="skill-declared-tool-setup"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
      expect(toolSettingsMock.getToolStatus).not.toHaveBeenCalled()
      const modal = wrapper.findComponent(ConfigModalStub)
      expect(modal.exists()).toBe(true)
      expect(modal.props('toolName')).toBe('serper')
    })

    it('routes an unconfigured enable through the config modal, not a blind enable', async () => {
      // Off, and the cascade has no defaults for `api_key`: the toggle
      // must land on the config modal like the tool row's own CTA does
      // instead of enabling a tool that still cannot run.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      await wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
        .find('[data-testid="skill-declared-tool-enable"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
      const modal = wrapper.findComponent(ConfigModalStub)
      expect(modal.exists()).toBe(true)
      expect(modal.props('toolName')).toBe('web_search')
    })

    it('renders no row for a skill whose required_tools is empty', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: [] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })

    it('renders no row for a skill payload that omits required_tools entirely', async () => {
      // A core that predates the field sends no key at all rather than an
      // empty list. The other skill carries a real declaration so there
      // is something to see: iterating `undefined` aborts the whole
      // computed, which drops the banner and leaves the previous DOM in
      // place — an absent banner alone cannot tell the two apart.
      const { required_tools, ...legacy } = skillSummary({ slug: 'media-library' })
      skills = [skillSummary({ slug: 'news-digest', required_tools: ['web_search'] }), legacy]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library', 'news-digest'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      const rows = wrapper.findAll('[data-testid^="skill-declared-tool-row-"]')
      expect(rows.map((r) => r.attributes('data-testid')))
        .toEqual(['skill-declared-tool-row-web_search'])
    })

    it('ignores a skill whose name matches the allowlist but whose slug does not', async () => {
      // The allowlist holds slugs. A name/slug mix-up here would surface
      // rows for a skill the agent never enabled.
      skills = [skillSummary({ name: 'media-library', slug: 'media-library-internal', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      toolSettingsMock.getAllToolStatuses.mockResolvedValue({
        web_search: { is_enabled: false, can_enable: true, missing_required: [] },
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })

    it('falls back to the agent tool list when the status map has no entry', async () => {
      // `getAllToolStatuses` returns `{}` when its own request fails, so a
      // missing entry must not be reported as "off".
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'skill' }, { tool_name: 'web_search' }] },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })

    it('reports a declared tool that is neither in the status map nor on the agent', async () => {
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      const row = wrapper.find('[data-testid="skill-declared-tool-row-web_search"]')
      expect(row.exists()).toBe(true)
      expect(row.find('[data-testid="skill-declared-tool-enable"]').exists()).toBe(true)
    })

    it('lists a tool declared by two enabled skills only once', async () => {
      skills = [
        skillSummary({ slug: 'media-library', required_tools: ['web_search'] }),
        skillSummary({ slug: 'news-digest', required_tools: ['web_search'] }),
      ]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library', 'news-digest'])
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()
      expect(wrapper.findAll('[data-testid="skill-declared-tool-row-web_search"]')).toHaveLength(1)
    })

    it('scopes the skills lookup to the agent\'s own principal', async () => {
      // `SkillController::index` answers with the union over every
      // principal the operator can see when `?principal_id=` is absent, so
      // on a group agent another principal's skills land in this list and
      // the banner reports their declarations as this agent's — a false
      // amber row on a tool that has nothing to do with this agent. The
      // narrowing is server-side, so the parameter is the whole contract
      // and the only thing the frontend can assert.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      mountSection({
        agent: { id: 1, tools: [{ tool_name: 'skill' }], principal_id: 7 },
      })
      await flushPromises()
      expect(skillsPaths()).toEqual(['/skills?principal_id=7'])
    })

    it('omits principal_id when the agent has none', async () => {
      // A bare `?principal_id=` would be discarded by core anyway; sending
      // it would only advertise that we asked for a narrowing we cannot
      // express.
      skills = [skillSummary({ slug: 'media-library', required_tools: ['web_search'] })]
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['media-library'])
      mountSection({
        agent: { id: 1, tools: [{ tool_name: 'skill' }], principal_id: null },
      })
      await flushPromises()
      expect(skillsPaths()).toEqual(['/skills'])
    })

    it('still renders the tool list when the skills lookup fails', async () => {
      // The banner is advisory: a 500 on `/skills` must not blank the Tools
      // tab, which is what the `.catch(() => null)` on that branch of the
      // `Promise.all` buys. Delete the catch and this fails — the rejection
      // escapes `onMounted` and the registry is never assigned.
      vi.mocked(api.get).mockImplementation(async (path: string) => {
        if (path.startsWith('/skills')) throw new Error('500')
        return { tools: baseRegistry }
      })
      const wrapper = mountSection({ agent: { id: 1, tools: [{ tool_name: 'skill' }] } })
      await flushPromises()

      expect(wrapper.findAll('.tool-item')).toHaveLength(9)
      expect(wrapper.get('[data-testid="result-count"]').text()).toBe('Showing 9 of 9')
      // No skills, so no declaration to report — the banner is simply absent.
      expect(wrapper.find('[data-testid="skill-declared-tools"]').exists()).toBe(false)
    })
  })
})
