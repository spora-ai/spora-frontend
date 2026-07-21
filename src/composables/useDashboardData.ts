/**
 * useDashboardData — central fetch + derived state for the new dashboard.
 *
 * The dashboard's mount-time fetch (`ensureLoaded`) and the manual `refresh`
 * button both delegate to the existing agent / task Pinia stores. This
 * composable does not own the network layer — it owns the *singletons*
 * (chip / query / sort filter state) and the derived KPIs and filtered agent
 * list that the dashboard grid binds to.
 *
 * Module-level `booted` means the first call kicks off the fetch and any
 * later call (e.g. from a sub-component on the same dashboard route) shares
 * the same in-flight or already-resolved state. This avoids a duplicate
 * fetchAgents / fetchTasks round-trip if `DashboardPage.vue` and a child
 * component both call `useDashboardData()` in `setup()`.
 *
 * KPIs (`runningTasks` / `awaitingTasks`) are derived from the existing
 * task store on the client rather than from a dedicated `/dashboard/kpis`
 * endpoint. The task list is already pulled at mount and pushed by SSE, so
 * a server round-trip would just be reading what we already have. The
 * `scheduledToday` KPI is derived from `useScheduledRunsCache` after the
 * page warms the cache via `warmScheduledRuns()`.
 *
 * `useRealtime()` is invoked with `skipDashboardPolling: true` so the
 * dashboard does not double-poll on top of its manual `refresh()` button.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import { useScheduledRunsCache } from '@/stores/scheduledRunsCache'
import { useToast } from '@/composables/useToast'
import { useRealtime } from '@/composables/useRealtime'
import type { Agent } from '@/types/agent'
import type { Task, TaskStatus } from '@/types/task'
import type { ScheduledRunResource } from '@/types/scheduledRun'

/** Chip filter — the dashboard's primary grouping axis. */
export type DashboardChip = 'all' | 'pinned' | 'favorites' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'

/** Sort key — what to order the agent grid by. */
export type DashboardSort = 'activity' | 'name' | 'created' | 'tasks'

/** Aggregate KPI counts shown on the dashboard. */
export interface KpiCounts {
  agents: number
  runningTasks: number
  awaitingTasks: number
  scheduledToday: number
}

/** Shape returned by {@link useDashboardData}. */
export interface UseDashboardDataReturn {
  /** True while the very first fetch is in flight (mount-time). */
  isLoading: Ref<boolean>
  /** True while a manual refresh is in flight (post-mount). */
  isRefreshing: Ref<boolean>
  /** Wall-clock time of the last successful refresh, or null until the first one. */
  lastUpdatedAt: Ref<Date | null>
  /** Force a refetch regardless of `booted` state. Sets `lastUpdatedAt` on success. */
  refresh: () => Promise<void>
  /**
   * True once `ensureLoaded` has completed the initial fetch. Re-mounts
   * read this to decide whether to short-circuit `ensureLoaded`.
   */
  booted: Ref<boolean>
  /** Reactive agents list from the store. */
  agents: ComputedRef<Agent[]>
  /** Reactive tasks list from the store. */
  tasks: ComputedRef<Task[]>
  /** Derived KPI counts for the header cards. */
  kpiCounts: ComputedRef<KpiCounts>
  /** Per-agent set of currently-active (non-terminal) task statuses. */
  activeStatesByAgent: ComputedRef<Map<number, Set<TaskStatus>>>
  /** Agents filtered by query + chip and sorted by the chosen sort key. */
  filteredAgents: ComputedRef<Agent[]>
  /** Filter state — chip / query / sort, all reactive. */
  state: {
    chip: Ref<DashboardChip>
    query: Ref<string>
    sort: Ref<DashboardSort>
  }
  /**
   * True when at least one loaded agent has `is_pinned === true`. Drives
   * the visibility of the Pinned chip and the Pinned section heading —
   * shared by `DashboardFilterChips` and `DashboardSections` so the gate
   * stays in lock-step between the chip row and the section grid.
   */
  pinnedVisible: ComputedRef<boolean>
  /**
   * True when at least one loaded agent has `is_favorite === true`. Drives
   * the visibility of the Favorites chip and the Favorites section
   * heading — shared by `DashboardFilterChips` and `DashboardSections`
   * so the gate stays in lock-step between the chip row and the section
   * grid. Mirrors `pinnedVisible` for the Favorites axis.
   */
  favoritesVisible: ComputedRef<boolean>
  /**
   * True when at least one loaded agent has `is_archived === true`. Same
   * role as `pinnedVisible`, for the Archived axis.
   */
  archivedVisible: ComputedRef<boolean>
  setChip: (next: DashboardChip) => void
  setQuery: (next: string) => void
  setSort: (next: DashboardSort) => void
  /** Run the mount-time fetch the first time; no-op on subsequent calls. */
  ensureLoaded: () => Promise<void>
  /**
   * Fan out a fetch of every agent's scheduled runs into
   * `useScheduledRunsCache` so KPI / chip derivations have data to read.
   * Called from `DashboardPage.onMounted` after `ensureLoaded`.
   */
  warmScheduledRuns: () => Promise<void>
}

/** Per-agent task count, used by the "tasks" sort comparator. */
function buildTaskCountByAgent(tasks: Task[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const t of tasks) {
    map.set(t.agent_id, (map.get(t.agent_id) ?? 0) + 1)
  }
  return map
}

/**
 * True if the agent has an active scheduled run whose `next_run_at` falls
 * within `windowMs` of `now`. Used for both the SCHEDULED chip filter and
 * the `scheduledToday` KPI.
 */
function agentHasUpcomingScheduledRun(
  runs: ScheduledRunResource[] | undefined,
  now: number,
  windowMs: number,
): boolean {
  if (!runs) return false
  for (const run of runs) {
    if (!run.is_active) continue
    const nextAt = run.next_run_at
    if (nextAt === null) continue
    const at = new Date(nextAt).getTime()
    if (Number.isNaN(at)) continue
    if (at <= now + windowMs) return true
  }
  return false
}

function agentMatchesChip(agent: Agent, chip: DashboardChip, statesByAgent: Map<number, Set<TaskStatus>>, scheduledRunsByAgent: ReadonlyMap<number, ScheduledRunResource[]>): boolean {
  switch (chip) {
    case 'all':
      return true
    case 'pinned':
      return Boolean(agent.is_pinned)
    case 'favorites':
      return Boolean(agent.is_favorite)
    case 'RUNNING':
      return statesByAgent.get(agent.id)?.has('RUNNING') === true
    case 'AWAITING':
      return statesByAgent.get(agent.id)?.has('PENDING_APPROVAL') === true
    case 'SCHEDULED':
      return agentHasUpcomingScheduledRun(
        scheduledRunsByAgent.get(agent.id),
        Date.now(),
        24 * 60 * 60 * 1000,
      )
    case 'archived':
      return agent.is_archived === true
  }
}

function agentMatchesQuery(agent: Agent, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  if (agent.name.toLowerCase().includes(needle)) return true
  if (agent.description?.toLowerCase().includes(needle) === true) return true
  for (const tool of agent.tools) {
    if (tool.tool_name.toLowerCase().includes(needle)) return true
    if (tool.tool_class.toLowerCase().includes(needle)) return true
  }
  return false
}

function compareAgents(a: Agent, b: Agent, sort: DashboardSort, lastTaskByAgent: ReadonlyMap<number, Task>, taskCountByAgent: ReadonlyMap<number, number>): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'created':
      // The agent API does not currently expose a created_at; pass-through order
      // (server-side order = insertion order) is the closest stable proxy.
      return 0
    case 'tasks':
      return (taskCountByAgent.get(b.id) ?? 0) - (taskCountByAgent.get(a.id) ?? 0)
    case 'activity': {
      const aLast = lastTaskByAgent.get(a.id)?.updated_at
      const bLast = lastTaskByAgent.get(b.id)?.updated_at
      if (aLast === undefined && bLast === undefined) return 0
      if (aLast === undefined) return 1
      if (bLast === undefined) return -1
      return new Date(bLast).getTime() - new Date(aLast).getTime()
    }
  }
}

let booted = false
const bootedRef: Ref<boolean> = ref(false)

// Module-level singletons. The Pinia stores (`agentStore`, `taskStore`,
// `scheduledRunsCache`) are already singletons via Pinia itself. The chip
// / query / sort refs must ALSO live at module scope so every component
// that calls useDashboardData() shares the same writable state. Without
// this, setChip in DashboardFilterChips would mutate a private copy
// that DashboardSections' filteredAgents never reads, and search / sort
// would appear to do nothing.
const chip = ref<DashboardChip>('all')
const query = ref('')
const sort = ref<DashboardSort>('activity')

export function useDashboardData(): UseDashboardDataReturn {
  const agentStore = useAgentStore()
  const taskStore = useTaskStore()
  const scheduledRunsCache = useScheduledRunsCache()
  const toast = useToast()

  // Opt into SSE updates from any server-pushed task event, but skip the
  // 30 s polling fallback the rest of the app wants. The dashboard's manual
  // `refresh()` button is the only on-demand refresh path here, so concurrent
  // auto-polling would double up.
  useRealtime({ skipDashboardPolling: true })

  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const lastUpdatedAt = ref<Date | null>(null)

  async function ensureLoaded(): Promise<void> {
    if (booted) return
booted = true
    bootedRef.value = true
    isLoading.value = true
    try {
      await Promise.all([agentStore.fetchAgents(), taskStore.fetchTasks()])
      lastUpdatedAt.value = new Date()
      await warmScheduledRuns()
    } catch {
      booted = false
      toast.error('Failed to load dashboard — tap Refresh to retry')
    } finally {
      isLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    isRefreshing.value = true
    try {
      await Promise.all([agentStore.fetchAgents(), taskStore.fetchTasks()])
      lastUpdatedAt.value = new Date()
      await warmScheduledRuns()
    } catch {
      toast.error('Refresh failed — try again')
    } finally {
      isRefreshing.value = false
    }
  }

  /**
   * Warm `useScheduledRunsCache` for every currently-loaded agent. Idempotent
   * — the cache store dedupes concurrent calls and short-circuits fresh
   * entries, so re-invoking on every refresh is cheap.
   */
  async function warmScheduledRuns(): Promise<void> {
    const ids = agents.value.map((a) => a.id)
    if (ids.length === 0) return
    try {
      await scheduledRunsCache.loadForAllAgents(ids)
    } catch {
      // Cache failures shouldn't break the dashboard — fall back to "no
      // scheduled runs known" and let the chip / KPI render zero. Surfacing
      // a toast here would be noisy since this runs on every refresh.
    }
  }

  const agents = computed(() => agentStore.agents)
  const tasks = computed(() => taskStore.tasks)

  /**
   * Map of agentId → cached scheduled runs for the currently-loaded agents.
   * Re-derives whenever the cache's underlying ref changes so KPI / chip
   * derivations see freshly-warmed entries without polling.
   */
  const scheduledRunsByAgent = computed<Map<number, ScheduledRunResource[]>>(() => {
    const map = new Map<number, ScheduledRunResource[]>()
    // Read the cache ref so the computed subscribes to invalidations /
    // refreshes — touching `.cache` registers a dependency.
    const cacheMap = scheduledRunsCache.cache
    for (const agent of agents.value) {
      const cached = scheduledRunsCache.getCached(agent.id)
      if (cached) {
        map.set(agent.id, cached)
      } else {
        // Keep the key present so reactive consumers see "no data yet".
        const entry = cacheMap.get(agent.id)
        if (entry) map.set(agent.id, entry.runs)
      }
    }
    return map
  })

  const kpiCounts = computed<KpiCounts>(() => {
    const { runningTasks, awaitingTasks } = taskStore.kpiCounts
    const now = Date.now()
    let scheduledToday = 0
    const window = 24 * 60 * 60 * 1000
    for (const agent of agents.value) {
      if (agentHasUpcomingScheduledRun(scheduledRunsByAgent.value.get(agent.id), now, window)) {
        scheduledToday++
      }
    }
    return {
      agents: agents.value.length,
      runningTasks,
      awaitingTasks,
      scheduledToday,
    }
  })

  const activeStatesByAgent = computed<Map<number, Set<TaskStatus>>>(() => taskStore.activeStatesByAgent)

  const filteredAgents = computed<Agent[]>(() => {
    const statesByAgent = activeStatesByAgent.value
    const lastTaskMap: ReadonlyMap<number, Task> = taskStore.lastTaskByAgent
    const taskCountMap = buildTaskCountByAgent(tasks.value)
    const q = query.value.trim()
    const chipFilter = chip.value
    const sortKey = sort.value
    const scheduledMap = scheduledRunsByAgent.value

    const filtered: Agent[] = []
    for (const agent of agents.value) {
      if (!agentMatchesQuery(agent, q)) continue
      if (!agentMatchesChip(agent, chipFilter, statesByAgent, scheduledMap)) continue
      filtered.push(agent)
    }
    filtered.sort((a, b) => compareAgents(a, b, sortKey, lastTaskMap, taskCountMap))
    return filtered
  })

  /**
   * Visibility gate for the Pinned chip + section. Lives on the composable
   * so `DashboardFilterChips` and `DashboardSections` cannot drift out of
   * sync — both components consume the same computed.
   */
  const pinnedVisible = computed<boolean>(() =>
    agents.value.some((a) => (a as { is_pinned?: boolean }).is_pinned === true),
  )

  /** Visibility gate for the Favorites chip + section. */
  const favoritesVisible = computed<boolean>(() =>
    agents.value.some((a) => a.is_favorite === true),
  )

  /** Visibility gate for the Archived chip + section. */
  const archivedVisible = computed<boolean>(() =>
    agents.value.some((a) => (a as { is_archived?: boolean }).is_archived === true),
  )

  function setChip(next: DashboardChip): void {
    chip.value = next
  }

  function setQuery(next: string): void {
    query.value = next
  }

  function setSort(next: DashboardSort): void {
    sort.value = next
  }

  return {
    isLoading,
    isRefreshing,
    lastUpdatedAt,
    refresh,
    booted: bootedRef,
    agents,
    tasks,
    kpiCounts,
    activeStatesByAgent,
    filteredAgents,
    pinnedVisible,
    favoritesVisible,
    archivedVisible,
    state: { chip, query, sort },
    setChip,
    setQuery,
    setSort,
    ensureLoaded,
    warmScheduledRuns,
  }
}
