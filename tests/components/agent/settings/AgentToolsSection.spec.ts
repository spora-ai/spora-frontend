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
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
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
vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => toolSettingsMock,
}))

import AgentToolsSection from '@/components/agent/settings/AgentToolsSection.vue'
import { api } from '@/api/client'

const ListItemStub = {
  name: 'AgentToolListItem',
  props: ['tool', 'enabled', 'saving', 'missingRequired', 'operationStates'],
  emits: ['toggle', 'openConfig', 'setUpAndEnable', 'toggleOperationEnabled', 'toggleOperationAutoApprove'],
  template: `
    <div class="tool-item" :data-tool-name="tool.tool_name" :data-enabled="enabled" :data-saving="saving">
      <button class="toggle" @click="$emit('toggle')">Toggle</button>
      <button class="config" @click="$emit('openConfig')">Config</button>
      <button class="setup-enable" data-testid="set-up-and-enable" @click="$emit('setUpAndEnable')">Set up & enable</button>
      <button class="op-enabled" @click="$emit('toggleOperationEnabled', 'op1')">Op1</button>
      <button class="op-auto" @click="$emit('toggleOperationAutoApprove', 'op1')">OpAuto</button>
    </div>
  `,
}
const ConfigModalStub = {
  name: 'AgentToolConfigModal',
  props: ['toolName', 'tool', 'agentId'],
  emits: ['saved', 'close'],
  template: '<div v-if="toolName" class="config-modal-stub"><button class="save-btn" @click="$emit(\'saved\', toolName)">Save</button></div>',
}
const ToolbarStub = {
  name: 'AgentToolsToolbar',
  props: ['categories', 'statusCounts', 'search', 'status', 'selected'],
  emits: ['update:search', 'update:status', 'update:selected'],
  template: '<div class="toolbar-stub" :data-status="status"></div>',
}

const baseAgent = { id: 1, tools: [] }
const baseRegistry = [
  { tool_class: 'Spora\\Tools\\WebSearch', tool_name: 'web_search', display_name: 'Web Search', description: 'Search the web', category: 'web', settings_schema: [] },
  { tool_class: 'Spora\\Tools\\Email', tool_name: 'send_email', display_name: 'Send Email', description: 'Send an email', category: 'communication', settings_schema: [] },
  { tool_class: 'Spora\\Tools\\Time', tool_name: 'time', display_name: 'Time', description: 'Tell the time', category: 'utility', settings_schema: [], operations: [{ name: 'now', description: 'Current time', enabledByDefault: true, requiresApprovalByDefault: false }] },
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
    expect(items).toHaveLength(3)
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

  it('opens the config modal directly when toggle is clicked on a tool missing required settings', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
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
      web_search: { is_enabled: false, can_enable: true, missing_required: [] },
    })
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: false, can_enable: false, missing_required: ['api_key'] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.toggle').trigger('click')
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
    expect(wrapper.findAll('.tool-item').length).toBe(3)
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
    expect(items).toHaveLength(3)
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
    expect(footer.text()).toBe('Showing 3 of 3')
  })

  it('updates result-count footer reactively when filters narrow the list', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const toolbar = wrapper.findComponent(ToolbarStub)
    await toolbar.vm.$emit('update:search', 'email')
    await flushPromises()
    expect(wrapper.find('[data-testid="result-count"]').text()).toBe('Showing 1 of 3')
  })

  it('opens config modal directly when Set up & enable CTA is clicked (no enable call yet)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.setup-enable').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    expect(wrapper.find('.config-modal-stub').exists()).toBe(true)
  })

  it('auto-enables the tool after config modal saves when Set up & enable was used (regression for configure-then-off bug)', async () => {
    toolSettingsMock.getAllToolStatuses.mockResolvedValue({
      web_search: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    toolSettingsMock.getToolStatus
      .mockResolvedValueOnce({ is_enabled: false, can_enable: true, missing_required: [] })
      .mockResolvedValueOnce({ is_enabled: true, can_enable: true, missing_required: [] })
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.setup-enable').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).not.toHaveBeenCalled()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(agentStoreMock.enableTool).toHaveBeenCalledWith(1, 'web_search')
    expect(wrapper.find('[data-tool-name="web_search"]').attributes('data-enabled')).toBe('true')
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
      web_search: { is_enabled: false, can_enable: false, missing_required: ['api_key'] },
    })
    toolSettingsMock.getToolStatus.mockResolvedValueOnce({ is_enabled: false, can_enable: true, missing_required: [] })
    agentStoreMock.enableTool.mockRejectedValueOnce(new ApiError('enable failed'))
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-tool-name="web_search"]').find('.setup-enable').trigger('click')
    await flushPromises()
    await wrapper.find('.config-modal-stub .save-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tools-error"]').text()).toBe('enable failed')
  })
})
