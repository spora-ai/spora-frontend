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
  loading: { value: false },
  error: { value: null },
  readEffectiveSkills: vi.fn(),
  addSkillsToAllowlist: vi.fn(),
  removeSkillsFromAllowlist: vi.fn(),
}
vi.mock('@/composables/useBundledSkills', () => ({
  useBundledSkills: () => bundledSkillsMock,
}))

const confirmMock = vi.fn()
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

import AgentToolsSection from '@/components/agent/settings/AgentToolsSection.vue'
import { api } from '@/api/client'

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
    'bundledSkillsEnabled',
    'bundledSkillsAvailable',
    'bundledSkillsLoading',
  ],
  emits: [
    'toggle',
    'openConfig',
    'setUpAndEnable',
    'toggleOperationEnabled',
    'toggleOperationAutoApprove',
    'toggleBundledSkills',
  ],
  template: `
    <div
      class="tool-item"
      :data-tool-name="tool.tool_name"
      :data-enabled="enabled"
      :data-saving="saving"
      :data-can-enable="canEnable"
      :data-bundled-enabled="bundledSkillsEnabled"
      :data-bundled-available="bundledSkillsAvailable"
      :data-bundled-loading="bundledSkillsLoading"
    >
      <button v-if="canEnable !== false || !tool.settings_schema || tool.settings_schema.length === 0" class="toggle" @click="$emit('toggle')">Toggle</button>
      <button v-if="canEnable === false && tool.settings_schema && tool.settings_schema.length > 0" class="setup-enable" data-testid="set-up-and-enable" @click="$emit('setUpAndEnable')">Set up & enable</button>
      <button class="config" @click="$emit('openConfig')">Config</button>
      <button class="op-enabled" @click="$emit('toggleOperationEnabled', 'op1')">Op1</button>
      <button class="op-auto" @click="$emit('toggleOperationAutoApprove', 'op1')">OpAuto</button>
      <button v-if="recommendsSkills && recommendsSkills.length > 0" class="bundled" data-testid="bundled-toggle-stub" @click="$emit('toggleBundledSkills')">Bundled</button>
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
  { tool_class: 'Spora\\Tools\\Time', tool_name: 'time', display_name: 'Time', description: 'Tell the time', category: 'utility', settings_schema: [], operations: [{ name: 'now', description: 'Current time', enabledByDefault: true, requiresApprovalByDefault: false }] },
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
  bundledSkillsMock.loading.value = false
  bundledSkillsMock.error.value = null
  confirmMock.mockReset()
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

    it('toggleBundledSkills (off→on) enables the SkillTool then unions the recommended slugs', async () => {
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue([])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'skill')
      expect(bundledSkillsMock.addSkillsToAllowlist).toHaveBeenCalledWith(['only-companion'])
    })

    it('toggleBundledSkills (on→off) just removes the recommended slugs from the allowlist', async () => {
      bundledSkillsMock.readEffectiveSkills.mockResolvedValue(['only-companion'])
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('[data-testid="bundled-toggle-stub"]').trigger('click')
      await flushPromises()
      expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
      expect(bundledSkillsMock.removeSkillsFromAllowlist).toHaveBeenCalledWith(['only-companion'])
    })

    it('toggleTool on a tool with unique recommended slugs opens the confirm dialog with the slug list', async () => {
      confirmMock.mockResolvedValueOnce(false)
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(confirmMock).toHaveBeenCalledTimes(1)
      const args = confirmMock.mock.calls[0] as unknown[]
      const message = args[0] as string
      const title = args[1] as string
      const confirmLabel = args[2] as string
      const cancelLabel = args[3] as string
      expect(title).toBe('Remove bundled skill(s)?')
      expect(confirmLabel).toBe('Remove')
      expect(cancelLabel).toBe('Keep')
      expect(message).toContain('only-companion')
    })

    it('toggleTool → Remove strips the unique slugs from the SkillTool allowlist', async () => {
      confirmMock.mockResolvedValueOnce(true)
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'companion')
      expect(bundledSkillsMock.removeSkillsFromAllowlist).toHaveBeenCalledWith(['only-companion'])
    })

    it('toggleTool → Keep disables the tool but leaves the SkillTool allowlist alone', async () => {
      confirmMock.mockResolvedValueOnce(false)
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'companion' }, { tool_name: 'skill' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="companion"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'companion')
      expect(bundledSkillsMock.removeSkillsFromAllowlist).not.toHaveBeenCalled()
    })

    it('toggleTool skips the dialog when the recommended slug is also recommended by another tool', async () => {
      // Two tools in the registry share `shared-skill`; disabling either
      // one doesn't orphan the slug from SkillTool's allowlist, so the
      // dialog is unnecessary.
      vi.mocked(api.get).mockReset()
      vi.mocked(api.get).mockResolvedValueOnce({
        tools: [
          { tool_class: 'X', tool_name: 'a', display_name: 'A', description: '', category: 'utility', settings_schema: [], recommends_skills: ['shared-skill'] },
          { tool_class: 'Y', tool_name: 'b', display_name: 'B', description: '', category: 'utility', settings_schema: [], recommends_skills: ['shared-skill'] },
        ],
      })
      const wrapper = mountSection({
        agent: { id: 1, tools: [{ tool_name: 'a' }, { tool_name: 'b' }] },
      })
      await flushPromises()
      await wrapper.find('[data-tool-name="a"]').find('.toggle').trigger('click')
      await flushPromises()
      expect(confirmMock).not.toHaveBeenCalled()
      expect(agentStoreMock.disableTool).toHaveBeenCalledWith(1, 'a')
      expect(bundledSkillsMock.removeSkillsFromAllowlist).not.toHaveBeenCalled()
    })
  })
})
