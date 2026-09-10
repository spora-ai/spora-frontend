/**
 * ScheduledRunsPage — list of scheduled runs for an agent.
 *
 * The page delegates all CRUD to `useScheduledRunsStore` (consolidated
 * from the previous cache + CRUD store pair). The store is mocked here
 * so the page test focuses on UI wiring — store behaviour is covered in
 * `tests/stores/scheduledRuns.spec.ts`.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
}))

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const fetchAgentsMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    fetchAgent: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
    fetchAgents: fetchAgentsMock,
  }),
}))

const invalidateMock = vi.fn()
const loadForAgentMock = vi.fn().mockResolvedValue([])
const toggleActiveMock = vi.fn().mockImplementation(async (run: { id: number; is_active: boolean }) => ({ ...run, is_active: !run.is_active }))
const deleteRunMock = vi.fn().mockResolvedValue(undefined)
const triggerRunMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/scheduledRuns', () => ({
  useScheduledRunsStore: () => ({
    invalidate: invalidateMock,
    invalidateAll: vi.fn(),
    loadForAgent: loadForAgentMock,
    toggleActive: toggleActiveMock,
    deleteRun: deleteRunMock,
    triggerRun: triggerRunMock,
    createRun: vi.fn(),
    updateRun: vi.fn(),
  }),
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

const AgentLayoutStub = { name: 'AgentLayout', template: '<div class="agent-layout-stub"><slot /></div>' }
const EditorStub = { name: 'SharedScheduleEditor', template: '<div class="editor-stub" />' }
const ToggleStub = {
  name: 'Toggle',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<button role="switch" :aria-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)" />',
}

import { api } from '@/api/client'
import ScheduledRunsPage from '@/pages/ScheduledRunsPage.vue'

const getMock = api.get as ReturnType<typeof vi.fn>

const sampleRun = (overrides: Partial<{ id: number; is_active: boolean; template_name: string | null; raw_prompt: string | null }> = {}) => ({
  id: 1, name: 'Daily', is_active: true, schedule_kind: 'recurring', template_name: null, template_id: null, raw_prompt: 'My run prompt', cron_expression: null, run_at: null, timezone: 'UTC', last_run_at: null, last_run_status: null, run_count: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
})

function mockRunsForAgent(runs: ReturnType<typeof sampleRun>[]): void {
  // Page still calls api.get for /agents/{id} — return a minimal agent
  // and the store mock for the runs. The store mock resolves to the
  // test's expected list every call (not just once) so post-mutation
  // re-fetches from `triggerRun`'s `loadData()` see the same rows.
  loadForAgentMock.mockReset()
  loadForAgentMock.mockResolvedValue(runs)
  getMock.mockReset()
  getMock.mockImplementation((url: string) => {
    if (url.endsWith('/agents/1')) return Promise.resolve({ agent: { id: 1, name: 'Test' } })
    return Promise.resolve({})
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  confirmMock.mockReset().mockResolvedValue(true)
  // Default to no runs; tests that need visible rows call
  // mockRunsForAgent([...]) before mountPage() to override.
  mockRunsForAgent([])
})

function mountPage() {
  return mount(ScheduledRunsPage, {
    global: { stubs: { AgentLayout: AgentLayoutStub, SharedScheduleEditor: EditorStub, Toggle: ToggleStub, Icon: true } },
  })
}

describe('ScheduledRunsPage', () => {
  it('mounts and fetches runs for the agent', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(loadForAgentMock).toHaveBeenCalledWith(1)
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('/agents/1'))
    wrapper.unmount()
  })

  it('renders the agent layout wrapper', () => {
    const wrapper = mountPage()
    expect(wrapper.find('.agent-layout-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the empty state when there are no runs', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('No scheduled runs')
    expect(wrapper.text()).toContain('New Schedule')
    wrapper.unmount()
  })

  it('renders scheduled runs when present', async () => {
    mockRunsForAgent([sampleRun({ id: 5 })])
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('My run prompt')
    wrapper.unmount()
  })

  it('shows an error banner when the load fails', async () => {
    loadForAgentMock.mockReset().mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to load scheduled runs')
    wrapper.unmount()
  })

  it('toggles the active state of a run via toggleActive', async () => {
    mockRunsForAgent([sampleRun({ id: 7, is_active: true })])
    const wrapper = mountPage()
    await flushPromises()
    const toggles = wrapper.findAll('button[role="switch"]')
    expect(toggles.length).toBeGreaterThan(0)
    await toggles[0].trigger('click')
    await flushPromises()
    expect(toggleActiveMock).toHaveBeenCalledWith(expect.objectContaining({ id: 7, is_active: true }))
    wrapper.unmount()
  })

  it('opens the editor when "New Schedule" is clicked', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const newBtn = wrapper.find('[data-testid="open-schedule-editor-empty"]')
    expect(newBtn.exists()).toBe(true)
    await newBtn.trigger('click')
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('triggers a run when the lightning button is clicked', async () => {
    mockRunsForAgent([sampleRun({ id: 9 })])
    const wrapper = mountPage()
    await flushPromises()
    const triggerBtn = wrapper.find('button[title="Trigger now"]')
    expect(triggerBtn.exists()).toBe(true)
    await triggerBtn.trigger('click')
    await flushPromises()
    expect(triggerRunMock).toHaveBeenCalledWith(1, 9)
    wrapper.unmount()
  })

  it('opens the editor when the edit button is clicked', async () => {
    mockRunsForAgent([sampleRun({ id: 11 })])
    const wrapper = mountPage()
    await flushPromises()
    const editBtn = wrapper.find('button[title="Edit"]')
    expect(editBtn.exists()).toBe(true)
    await editBtn.trigger('click')
    expect(wrapper.find('.editor-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('deletes a run after confirming the dialog', async () => {
    mockRunsForAgent([sampleRun({ id: 11 })])
    const wrapper = mountPage()
    await flushPromises()
    const delBtn = wrapper.find('button[title="Delete"]')
    expect(delBtn.exists()).toBe(true)
    await delBtn.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalled()
    expect(deleteRunMock).toHaveBeenCalledWith(1, 11)
    wrapper.unmount()
  })

  it('does not delete when the confirm dialog is cancelled', async () => {
    confirmMock.mockResolvedValue(false)
    mockRunsForAgent([sampleRun({ id: 11 })])
    const wrapper = mountPage()
    await flushPromises()
    const delBtn = wrapper.find('button[title="Delete"]')
    await delBtn.trigger('click')
    await flushPromises()
    expect(deleteRunMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // Regression: cache has a 5-minute TTL; mutations must invalidate so the
  // dashboard's KPI does not stay stale until the TTL expires.
  it('patches the cache entry when toggling active', async () => {
    mockRunsForAgent([sampleRun({ id: 7, is_active: true })])
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('button[role="switch"]')[0].trigger('click')
    await flushPromises()
    // The store patches its own cache entry in place — the page never
    // invalidates manually. Triggering the toggle still calls the
    // store, which keeps the dashboard's next read fresh.
    expect(toggleActiveMock).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    wrapper.unmount()
  })

  it('patches the cache entry when deleting a run', async () => {
    mockRunsForAgent([sampleRun({ id: 11 })])
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('button[title="Delete"]').trigger('click')
    await flushPromises()
    expect(deleteRunMock).toHaveBeenCalledWith(1, 11)
    wrapper.unmount()
  })

  it('invalidates the cache after triggering a run (trigger returns no payload)', async () => {
    mockRunsForAgent([sampleRun({ id: 9 })])
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('button[title="Trigger now"]').trigger('click')
    await flushPromises()
    // The store's `triggerRun` action invalidates the cache internally
    // because the server's trigger endpoint returns no row payload, so
    // the dashboard must re-fetch on its next read. The page itself
    // doesn't call invalidate — it just delegates to the store. We
    // assert the delegation fired with the right ids.
    expect(triggerRunMock).toHaveBeenCalledWith(1, 9)
    wrapper.unmount()
  })

  it('invalidates the cache after the wizard saves a new run', async () => {
    mockRunsForAgent([])
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="open-schedule-editor-empty"]').trigger('click')
    const editor = wrapper.findComponent({ name: 'SharedScheduleEditor' })
    expect(editor.exists()).toBe(true)
    editor.vm.$emit('saved', { id: 42 })

    expect(invalidateMock).toHaveBeenCalledWith(1)
    wrapper.unmount()
  })
})
