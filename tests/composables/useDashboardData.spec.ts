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

const principalsRef = ref<Array<{ id: number; type: 'user' | 'group'; name: string; user_id?: number; group_id?: number }>>([])
const principalsLoadMock = vi.fn().mockResolvedValue([])
vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => ({
    get principals() { return principalsRef.value },
    load: principalsLoadMock,
  }),
}))

const scheduledCacheMock = {
  cache: new Map<number, { runs: unknown[]; expiresAt: number }>(),
  getCached: vi.fn<(id: number) => unknown[] | undefined>(),
  setCached: vi.fn(),
  loadForAgent: vi.fn(),
  loadForAllAgents: vi.fn(),
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
}

vi.mock('@/stores/scheduledRunsCache', () => ({
  useScheduledRunsCache: () => scheduledCacheMock,
}))

import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
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
    scheduledCacheMock.invalidate.mockReset()
    scheduledCacheMock.invalidateAll.mockReset()
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

  it('kpiCounts derives from tasks (deduped-by-agent; 2 RUNNING + 3 PENDING_APPROVAL + 4 ABORTED across distinct agents)', async () => {
    // Post-0073: group-shared agents surface every member's run. The
    // KPI counts distinct agents (not raw rows) so a shared agent with
    // N members each having a RUNNING task counts as 1, not N. Pin the
    // new dedupe contract: each row's agent_id is distinct so dedupe is
    // a no-op, and the counts match the raw row totals.
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1 }),
      makeAgent({ id: 2 }),
      makeAgent({ id: 3 }),
      makeAgent({ id: 4 }),
      makeAgent({ id: 5 }),
    ]
    taskStore.tasks = [
      makeTask({ id: 1, agent_id: 1, status: 'RUNNING' }),
      makeTask({ id: 2, agent_id: 2, status: 'RUNNING' }),
      makeTask({ id: 3, agent_id: 3, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 4, agent_id: 4, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 5, agent_id: 5, status: 'PENDING_APPROVAL' }),
      makeTask({ id: 6, agent_id: 1, status: 'COMPLETED' }),
      makeTask({ id: 7, agent_id: 2, status: 'ABORTED' }),
      makeTask({ id: 8, agent_id: 3, status: 'ABORTED' }),
      makeTask({ id: 9, agent_id: 4, status: 'ABORTED' }),
      makeTask({ id: 10, agent_id: 5, status: 'ABORTED' }),
    ]

    const { kpiCounts } = useDashboardData()
    expect(kpiCounts.value.agents).toBe(5)
    expect(kpiCounts.value.runningTasks).toBe(2)
    expect(kpiCounts.value.awaitingTasks).toBe(3)
    expect(kpiCounts.value.abortedTasks).toBe(4)
  })

  it('filteredAgents includes agents with ABORTED tasks when the chip is ABORTED', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    const a1 = makeAgent({ id: 1 })
    const a2 = makeAgent({ id: 2 })
    agentStore.agents = [a1, a2]
    taskStore.tasks = [
      makeTask({ id: 1, agent_id: 1, status: 'ABORTED' }),
      makeTask({ id: 2, agent_id: 2, status: 'RUNNING' }),
    ]

    const { filteredAgents, setChip } = useDashboardData()
    setChip('ABORTED' as never)
    const filtered = filteredAgents.value.map((a) => a.id)
    expect(filtered).toContain(1)
    expect(filtered).not.toContain(2)
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

  it('filteredAgents — chip="favorites" returns only favorite agents and exposes visibility', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [
      makeAgent({ id: 1, name: 'Favorite Agent', is_favorite: true }),
      makeAgent({ id: 2, name: 'Not Favorite', is_favorite: false }),
    ]
    taskStore.tasks = []

    const { filteredAgents, favoritesVisible, setChip } = useDashboardData()
    expect(favoritesVisible.value).toBe(true)
    setChip('favorites')
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

  // Regression: scheduled-runs cache has a 5-minute TTL that would otherwise
  // short-circuit a warm fetch and serve stale data after a new schedule.
  it('ensureLoaded invalidates the scheduled-runs cache before warming', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 8 })]
    taskStore.tasks = []
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    const { ensureLoaded } = useDashboardData()
    await ensureLoaded()

    expect(scheduledCacheMock.invalidateAll).toHaveBeenCalledTimes(1)
    expect(scheduledCacheMock.loadForAllAgents).toHaveBeenCalledTimes(1)
    expect(scheduledCacheMock.invalidateAll.mock.invocationCallOrder[0]!)
      .toBeLessThan(scheduledCacheMock.loadForAllAgents.mock.invocationCallOrder[0]!)
  })

  it('refresh invalidates the scheduled-runs cache before warming', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    agentStore.agents = [makeAgent({ id: 8 })]
    taskStore.tasks = []
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    const { ensureLoaded, refresh } = useDashboardData()
    await ensureLoaded()
    await refresh()

    expect(scheduledCacheMock.invalidateAll).toHaveBeenCalledTimes(2)
    expect(scheduledCacheMock.loadForAllAgents).toHaveBeenCalledTimes(2)
    expect(scheduledCacheMock.invalidateAll.mock.invocationCallOrder[1]!)
      .toBeLessThan(scheduledCacheMock.loadForAllAgents.mock.invocationCallOrder[1]!)
  })

  it('setPrincipalFilter narrows filteredAgents to a single principal scope', async () => {
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const { useAuthStore } = await import('@/stores/auth')
    const { usePrincipalsStore } = await import('@/stores/principals')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)

    // Wire the auth + principals stores so callerPrincipalId resolves
    // to principal #10. The composable reads both stores; without
    // seeded stores the caller's user-principal is null and 'mine'
    // filters to an empty result.
    const authStore = useAuthStore()
    const principalsStore = usePrincipalsStore()
    authStore.$patch({ user: { id: 99, email: 'me@x.com', is_admin: false, roles: ['USER'] } })
    // Options-style stores expose top-level setters; setup-style stores
    // (defineStore('x', () => ...)) return refs directly. The principals
    // store is options-style, so direct assignment works.
    principalsStore.principals.splice(0, principalsStore.principals.length, {
      id: 10,
      type: 'user',
      name: 'You',
      user_id: 99,
      group_id: undefined,
    })

    agentStore.agents = [
      makeAgent({
        id: 1,
        name: 'Mine',
        principal_id: 10,
        principal: { id: 10, type: 'user', name: 'You', user_id: 99, group_id: undefined },
      }),
      makeAgent({
        id: 2,
        name: 'Eng',
        principal_id: 20,
        principal: { id: 20, type: 'group', name: 'Engineering', user_id: undefined, group_id: 1 },
      }),
      makeAgent({
        id: 3,
        name: 'Ops',
        principal_id: 30,
        principal: { id: 30, type: 'group', name: 'Operations', user_id: undefined, group_id: 2 },
      }),
    ]
    taskStore.tasks = []

    const { filteredAgents, setPrincipalFilter } = useDashboardData()
    // Default scope is 'all' — every agent is visible.
    expect(filteredAgents.value.map((a) => a.id)).toEqual([1, 2, 3])

    // Single-select: pick a group by group_id (NOT principal_id —
    // principalFilter carries the group_id for stable labels/URLs).
    // Engineering has group_id 1; Operations has group_id 2.
    setPrincipalFilter(1)
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([2])

    // Switch to a different group — single-select replaces, no merging.
    setPrincipalFilter(2)
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([3])

    // 'mine' scope filters to the caller's user-principal (id 10).
    setPrincipalFilter('mine')
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([1])

    // Reset to 'all'.
    setPrincipalFilter('all')
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([1, 2, 3])
  })

  it('group scope compares against agent.principal.group_id (regression)', async () => {
    // Bug lock: the original implementation compared
    // `agent.principal_id !== principalFilter`, but principalFilter carries
    // the *group_id* (not the principal_id). Since group ids (1, 2…)
    // never match the principal ids (100, 101…), every group chip
    // rendered an empty grid. The fix compares against
    // `agent.principal.group_id`, the actual key that joins.
    const { useDashboardData } = await import('@/composables/useDashboardData')
    const { useAuthStore } = await import('@/stores/auth')
    const agentStore = useAgentStore()
    const taskStore = useTaskStore()
    vi.spyOn(agentStore, 'fetchAgents').mockResolvedValue(undefined)
    vi.spyOn(taskStore, 'fetchTasks').mockResolvedValue(undefined)
    useAuthStore().$patch({ user: null })

    // Group 1 (Engineering) has principal id 100 + group_id 1.
    // Group 2 (Operations)  has principal id 101 + group_id 2.
    agentStore.agents = [
      makeAgent({
        id: 1,
        name: 'Eng-1',
        principal_id: 100,
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: undefined, group_id: 1 },
      }),
      makeAgent({
        id: 2,
        name: 'Eng-2',
        principal_id: 100,
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: undefined, group_id: 1 },
      }),
      makeAgent({
        id: 3,
        name: 'Ops-1',
        principal_id: 101,
        principal: { id: 101, type: 'group', name: 'Operations', user_id: undefined, group_id: 2 },
      }),
    ]
    taskStore.tasks = []

    const { filteredAgents, setPrincipalFilter } = useDashboardData()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([1, 2, 3])

    // Pick group_id 1 — should return both Eng agents.
    setPrincipalFilter(1)
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([1, 2])

    // Pick group_id 2 — should return the Ops agent only.
    setPrincipalFilter(2)
    await flushPromises()
    expect(filteredAgents.value.map((a) => a.id)).toEqual([3])
  })
})
