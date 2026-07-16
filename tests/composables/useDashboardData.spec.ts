/**
 * useDashboardData tests.
 *
 * Covers the mount-time fetch singleton, manual refresh, derived KPIs,
 * the per-agent active-status map, and the query/chip/sort filter pipeline.
 *
 * `useRealtime` is mocked to a no-op so the composable can be exercised
 * without a real EventSource / auth store. `useScheduledRunsCache` is mocked
 * so KPI / chip derivations can be driven deterministically.
 *
 * NOTE: the composable caches `booted` at module level. The import order
 * matters here — we deliberately import `useDashboardData` lazily inside
 * each test (after `vi.resetModules()` in `beforeEach`) so the singleton
 * resets between tests, otherwise the first `ensureLoaded()` would carry
 * over to subsequent tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/composables/useRealtime', () => ({
  useRealtime: vi.fn(),
}))

const scheduledCacheMock = {
  cache: new Map<number, { runs: unknown[]; expiresAt: number }>(),
  getCached: vi.fn<(id: number) => unknown[] | undefined>(),
  setCached: vi.fn(),
  loadForAgent: vi.fn(),
  loadForAllAgents: vi.fn(),
  invalidate: vi.fn(),
}

vi.mock('@/stores/scheduledRunsCache', () => ({
  useScheduledRunsCache: () => scheduledCacheMock,
}))

import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'
import type { ScheduledRunResource } from '@/types/scheduledRun'

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,    name: 'Calendar Wrangler',
    description: 'Keeps my calendar tidy',
    system_prompt: null,
    llm_driver_config_id: null,
    max_steps: 10,
    is_active: true,
    tools: [{ tool_class: 'CalendarTool', tool_name: 'calendar' }],
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    agent_id: 1,
    status: 'RUNNING',
    user_prompt: 'Hi',
    final_response: null,
    step_count: 1,
    max_steps: 10,
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:01Z',
    ...overrides,
  }
}

function makeScheduledRun(overrides: Partial<ScheduledRunResource> = {}): ScheduledRunResource {
  return {
    id: 1,
    agent_id: 1,
    template_id: null,
    raw_prompt: null,
    cron_expression: '0 9 * * *',
    run_at: null,
    timezone: 'UTC',
    max_steps_override: null,
    is_active: true,
    last_run_at: null,
    next_run_at: '2026-07-15T09:00:00Z',
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
    ...overrides,
  }
}

describe('useDashboardData', () => {
  beforeEach(() => {
    // useDashboardData caches `booted` at module level — clear the module
    // so each test gets a fresh singleton instead of inheriting the previous
    // test's `ensureLoaded()` result. The active Pinia is rebuilt by the
    // global setup.ts beforeEach.
    vi.resetModules()
    scheduledCacheMock.cache.clear()
    scheduledCacheMock.getCached.mockReset()
    scheduledCacheMock.loadForAllAgents.mockReset()
    scheduledCacheMock.loadForAllAgents.mockResolvedValue(new Map())
    scheduledCacheMock.getCached.mockReturnValue(undefined)
  })

  it('ensureLoaded is called once — subsequent call is a no-op', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    const fetchAgentsSpy = vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    const fetchTasksSpy = vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    const { ensureLoaded } = useDashboardData()
    await ensureLoaded()
    await ensureLoaded()
    await ensureLoaded()

    expect(fetchAgentsSpy).toHaveBeenCalledTimes(1)
    expect(fetchTasksSpy).toHaveBeenCalledTimes(1)
  })

  it('refresh re-fetches even when already loaded', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    const { ensureLoaded, refresh } = useDashboardData()
    await ensureLoaded()
    await refresh()
    await refresh()

    expect(agentStore.fetchAgents).toHaveBeenCalledTimes(3)
    expect(taskStore.fetchTasks).toHaveBeenCalledTimes(3)
  })

  it('refresh sets lastUpdatedAt on success', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    const { ensureLoaded, lastUpdatedAt } = useDashboardData()
    expect(lastUpdatedAt.value).toBeNull()
    await ensureLoaded()
    expect(lastUpdatedAt.value).toBeInstanceOf(Date)
  })

  it('kpiCounts derives from tasks (2 RUNNING + 3 PENDING_APPROVAL)', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 1 })]
    taskStore.tasks = [
      makeTask({ id: 1, status: 'RUNNING' }),
      makeTask({ id: 2, status: 'RUNNING' }),
      makeTask({ id: 3, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 4, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 5, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 6, status: 'COMPLETED' }),
    ]

    const { kpiCounts } = useDashboardData()
    expect(kpiCounts.value.agents).toBe(1)
    expect(kpiCounts.value.runningTasks).toBe(2)
    expect(kpiCounts.value.awaitingTasks).toBe(3)
  })

  it('scheduledToday KPI counts agents with an active run in the next 24h', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 1 }), makeAgent({ id: 2 })]
    taskStore.tasks = []

    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    scheduledCacheMock.getCached.mockImplementation((id: number) => {
      if (id === 1) return [makeScheduledRun({ agent_id: 1, next_run_at: soon })]
      if (id === 2) return [makeScheduledRun({ agent_id: 2, next_run_at: later })]
      return undefined
    })

    const { kpiCounts } = useDashboardData()
    expect(kpiCounts.value.scheduledToday).toBe(1)
  })

  it('scheduledToday KPI falls back to 0 when cache is empty', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 1 })]
    taskStore.tasks = []

    const { kpiCounts } = useDashboardData()
    expect(kpiCounts.value.scheduledToday).toBe(0)
  })

  it('activeStatesByAgent returns only non-terminal statuses', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = []
    taskStore.tasks = [
      makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
      makeTask({ id: 2, agent_id: 1, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 3, agent_id: 1, status: 'COMPLETED' }),
      makeTask({ id: 4, agent_id: 1, status: 'FAILED' }),
      makeTask({ id: 5, agent_id: 2, status: 'PENDING' }),
      makeTask({ id: 6, agent_id: 2, status: 'CANCELLED' }),
    ]

    const { activeStatesByAgent } = useDashboardData()
    const agent1States = activeStatesByAgent.value.get(1)
    const agent2States = activeStatesByAgent.value.get(2)
    expect(agent1States).toBeDefined()
    expect(agent1States!.has('RUNNING')).toBe(true)
    expect(agent1States!.has('PENDING_APPROVAL')).toBe(true)
    expect(agent1States!.has('COMPLETED')).toBe(false)
    expect(agent1States!.has('FAILED')).toBe(false)
    expect(agent2States).toBeDefined()
    expect(agent2States!.has('PENDING')).toBe(true)
    expect(agent2States!.has('CANCELLED')).toBe(false)
  })

  it('filteredAgents — query="Calendar" returns Calendar Wrangler only', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Calendar Wrangler', description: 'Keeps my calendar tidy' }),
      makeAgent({ id: 2, name: 'Email Butler', description: 'Sorts my inbox', tools: [{ tool_class: 'EmailTool', tool_name: 'email' }] }),
    ]
    taskStore.tasks = []

    const { filteredAgents, setQuery } = useDashboardData()
    setQuery('Calendar')
    expect(filteredAgents.value.map(a => a.id)).toEqual([1])
  })

  it('filteredAgents — chip="pinned" returns only pinned agents', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Pinned Agent', is_pinned: true }),
      makeAgent({ id: 2, name: 'Not Pinned' }),
    ]
    taskStore.tasks = []

    const { filteredAgents, setChip } = useDashboardData()
    setChip('pinned')
    expect(filteredAgents.value.map(a => a.id)).toEqual([1])
  })

  it('filteredAgents — chip="SCHEDULED" reads from the scheduled-runs cache', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 1 }), makeAgent({ id: 2 })]
    taskStore.tasks = []

    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    scheduledCacheMock.getCached.mockImplementation((id: number) => {
      if (id === 1) return [makeScheduledRun({ agent_id: 1, next_run_at: soon })]
      return []
    })

    const { filteredAgents, setChip } = useDashboardData()
    setChip('SCHEDULED')
    expect(filteredAgents.value.map(a => a.id)).toEqual([1])
  })

  it('setChip / setQuery / setSort update state', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = []
    taskStore.tasks = []

    const { state, setChip, setQuery, setSort } = useDashboardData()
    expect(state.chip.value).toBe('all')
    expect(state.query.value).toBe('')
    expect(state.sort.value).toBe('activity')

    setChip('RUNNING')
    setQuery('foo')
    setSort('name')

    expect(state.chip.value).toBe('RUNNING')
    expect(state.query.value).toBe('foo')
    expect(state.sort.value).toBe('name')
  })

  // Regression: chip / query / sort must be module-level singletons. If
  // a future refactor moves them back into the function body, the chip
  // row's setChip would mutate a private copy that DashboardSections'
  // filteredAgents never reads, and the dashboard silently appears to do
  // nothing. This test exercises that cross-caller contract directly.
  it('chip / query / sort state is shared across separate useDashboardData() calls', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Alpha' }),
      makeAgent({ id: 2, name: 'Beta' }),
    ]
    taskStore.tasks = []

    // "Toolbar" writes here.
    const writer = useDashboardData()
    // "Sections" reads here. They share the same module-level refs.
    const reader = useDashboardData()

    writer.setQuery('Alpha')
    expect(reader.state.query.value).toBe('Alpha')
    expect(reader.filteredAgents.value.map((a) => a.id)).toEqual([1])

    writer.setChip('RUNNING')
    writer.setSort('name')
    expect(reader.state.chip.value).toBe('RUNNING')
    expect(reader.state.sort.value).toBe('name')

    // Reset chip so the second setQuery round-trip isn't filtered by the
    // RUNNING chip (no test agent carries an active RUNNING task here).
    writer.setChip('all')
    reader.setQuery('Beta')
    expect(writer.state.query.value).toBe('Beta')
    expect(writer.filteredAgents.value.map((a) => a.id)).toEqual([2])

    // Reader can also write, and the writer sees it. (Symmetric assertion.)
    writer.setQuery('')
    expect(reader.state.query.value).toBe('')
    expect(reader.filteredAgents.value.map((a) => a.id)).toEqual([1, 2])
  })

  it('filteredAgents — sort by name uses locale alphabetical order', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Charlie' }),
      makeAgent({ id: 2, name: 'Alpha' }),
      makeAgent({ id: 3, name: 'Bravo' }),
    ]
    taskStore.tasks = []

    const { filteredAgents, setSort } = useDashboardData()
    setSort('name')
    expect(filteredAgents.value.map(a => a.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('warmScheduledRuns fans out a single loadForAllAgents call with agent ids', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 7 }), makeAgent({ id: 8 })]
    taskStore.tasks = []

    const { warmScheduledRuns } = useDashboardData()
    await warmScheduledRuns()

    expect(scheduledCacheMock.loadForAllAgents).toHaveBeenCalledTimes(1)
    expect(scheduledCacheMock.loadForAllAgents).toHaveBeenCalledWith([7, 8])
  })

  it('pinnedVisible is true when at least one loaded agent has is_pinned=true', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Plain' }),
      makeAgent({ id: 2, name: 'Pinned', is_pinned: true }),
    ]
    taskStore.tasks = []

    const { pinnedVisible } = useDashboardData()
    expect(pinnedVisible.value).toBe(true)
  })

  it('pinnedVisible is false when no loaded agent carries is_pinned (tolerates undefined)', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Plain' }),
      // is_pinned explicitly false / undefined must not count as "visible".
      makeAgent({ id: 2, name: 'False', is_pinned: false }),
    ]
    taskStore.tasks = []

    const { pinnedVisible } = useDashboardData()
    expect(pinnedVisible.value).toBe(false)
  })

  it('pinnedVisible is false on an empty agent list', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = []
    taskStore.tasks = []

    const { pinnedVisible } = useDashboardData()
    expect(pinnedVisible.value).toBe(false)
  })

  it('archivedVisible is true when at least one loaded agent has is_archived=true', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Plain' }),
      makeAgent({ id: 2, name: 'Archived', is_archived: true }),
    ]
    taskStore.tasks = []

    const { archivedVisible } = useDashboardData()
    expect(archivedVisible.value).toBe(true)
  })

  it('archivedVisible is false when no loaded agent carries is_archived (tolerates undefined)', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Plain' }),
      makeAgent({ id: 2, name: 'False', is_archived: false }),
    ]
    taskStore.tasks = []

    const { archivedVisible } = useDashboardData()
    expect(archivedVisible.value).toBe(false)
  })

  it('pinnedVisible and archivedVisible are independent — flagging one does not enable the other', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Pinned Only', is_pinned: true }),
    ]
    taskStore.tasks = []

    const { pinnedVisible, archivedVisible } = useDashboardData()
    expect(pinnedVisible.value).toBe(true)
    expect(archivedVisible.value).toBe(false)
  })
})
