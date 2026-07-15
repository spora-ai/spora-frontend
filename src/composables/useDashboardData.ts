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
 * scheduled-runs KPI is a placeholder (`0`) until the cached
 * scheduled-runs store lands; once it does, swap the placeholder for a
 * reactive read on that store.
 *
 * `useRealtime()` is invoked (no options for now) so the page opts into SSE
 * task updates. When the `skipDashboardPolling: true` option is plumbed
 * through {@link useRealtime}, pass it here so the dashboard does not
 * double-poll on top of its manual `refresh()` button.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useTaskStore } from '@/stores/tasks'
import { useToast } from '@/composables/useToast'
import { useRealtime } from '@/composables/useRealtime'
import type { Agent } from '@/types/agent'
import type { Task, TaskStatus } from '@/types/task'

/** Chip filter — the dashboard's primary grouping axis. */
export type DashboardChip = 'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'

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
  setChip: (next: DashboardChip) => void
  setQuery: (next: string) => void
  setSort: (next: DashboardSort) => void
  /** Run the mount-time fetch the first time; no-op on subsequent calls. */
  ensureLoaded: () => Promise<void>
}

/** Non-terminal task statuses that contribute to the dashboard's "active" pills. */
const NON_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['PENDING', 'RUNNING', 'PENDING_APPROVAL'])

/**
 * Build a per-agent set of currently-active (non-terminal) task statuses.
 * Used by `activeStatesByAgent` and as a fallback if the store getter is
 * absent. A single agent can have multiple concurrent states (e.g. one
 * RUNNING task + one PENDING_APPROVAL task), so the value is a Set.
 */
function buildActiveStatesByAgent(tasks: Task[]): Map<number, Set<TaskStatus>> {
  const map = new Map<number, Set<TaskStatus>>()
  for (const t of tasks) {
    if (!NON_TERMINAL_STATUSES.has(t.status)) continue
    let set = map.get(t.agent_id)
    if (!set) { set = new Set(); map.set(t.agent_id, set) }
    set.add(t.status)
  }
  return map
}

/**
 * Build the per-agent task-count map once per recompute.
 * `tasks` is reused across multiple sort/filter passes so caching it avoids
 * O(agents x tasks) scans on every keystroke.
 */
function buildTaskCountByAgent(tasks: Task[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const t of tasks) {
    map.set(t.agent_id, (map.get(t.agent_id) ?? 0) + 1)
  }
  return map
}

function agentMatchesChip(agent: Agent, chip: DashboardChip, statesByAgent: Map<number, Set<TaskStatus>>, lastTaskByAgent: ReadonlyMap<number, Task>): boolean {
  switch (chip) {
    case 'all':
      return true
    case 'pinned':
      return Boolean((agent as Agent & { is_pinned?: boolean }).is_pinned)
    case 'RUNNING':
      return statesByAgent.get(agent.id)?.has('RUNNING') === true
    case 'AWAITING':
      return statesByAgent.get(agent.id)?.has('PENDING_APPROVAL') === true
    case 'SCHEDULED':
      // Scheduled-runs store not yet wired in; an agent with a future-runnable
      // last task is treated as scheduled as a soft default. Once the
      // scheduled-runs cache lands this becomes a direct lookup.
      return lastTaskByAgent.get(agent.id)?.status === 'PENDING'
    case 'archived':
      return (agent as Agent & { is_archived?: boolean }).is_archived === true
  }
}

function agentMatchesQuery(agent: Agent, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  if (agent.name.toLowerCase().includes(needle)) return true
  if (agent.description !== null && agent.description.toLowerCase().includes(needle)) return true
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

/**
 * Acquire the dashboard's fetch + filter state.
 *
 * Module-level singleton: only the first call triggers `ensureLoaded()`'s
 * fetch. Subsequent calls (e.g. from a sub-component) reuse the same
 * chip / query / sort refs and the same `isLoading` / `isRefreshing` /
 * `lastUpdatedAt` flags, so the whole dashboard grid stays in sync.
 */
export function useDashboardData(): UseDashboardDataReturn {
  const agentStore = useAgentStore()
  const taskStore = useTaskStore()
  const toast = useToast()

  // Opt into SSE updates from any server-pushed task event, but skip the
  // 30 s polling fallback the rest of the app wants. The dashboard's manual
  // `refresh()` button is the only on-demand refresh path here, so concurrent
  // auto-polling would double up.
  useRealtime({ skipDashboardPolling: true })

  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const lastUpdatedAt = ref<Date | null>(null)
  const chip = ref<DashboardChip>('all')
  const query = ref('')
  const sort = ref<DashboardSort>('activity')

  async function ensureLoaded(): Promise<void> {
    if (booted) return
    booted = true
    isLoading.value = true
    try {
      await Promise.all([agentStore.fetchAgents(), taskStore.fetchTasks()])
      lastUpdatedAt.value = new Date()
    } finally {
      isLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    isRefreshing.value = true
    try {
      await Promise.all([agentStore.fetchAgents(), taskStore.fetchTasks()])
      lastUpdatedAt.value = new Date()
    } catch {
      toast.error('Refresh failed — try again')
    } finally {
      isRefreshing.value = false
    }
  }

  const agents = computed(() => agentStore.agents)
  const tasks = computed(() => taskStore.tasks)

  const kpiCounts = computed<KpiCounts>(() => {
    // Prefer the store's getter if it exists (the parallel unit adds it);
    // fall back to a local scan so this composable still compiles today.
    const storeKpis = (taskStore as unknown as { kpiCounts?: { runningTasks: number; awaitingTasks: number } }).kpiCounts
    let runningTasks = 0
    let awaitingTasks = 0
    if (storeKpis !== undefined) {
      runningTasks = storeKpis.runningTasks
      awaitingTasks = storeKpis.awaitingTasks
    } else {
      for (const t of tasks.value) {
        if (t.status === 'RUNNING') runningTasks++
        else if (t.status === 'PENDING_APPROVAL') awaitingTasks++
      }
    }
    return {
      agents: agents.value.length,
      runningTasks,
      awaitingTasks,
      // Placeholder — plug in the cached scheduled-runs store once it lands.
      scheduledToday: 0,
    }
  })

  const activeStatesByAgent = computed<Map<number, Set<TaskStatus>>>(() => {
    const storeGetter = (taskStore as unknown as { activeStatesByAgent?: Map<number, Set<TaskStatus>> }).activeStatesByAgent
    if (storeGetter !== undefined) return storeGetter
    return buildActiveStatesByAgent(tasks.value)
  })

  const filteredAgents = computed<Agent[]>(() => {
    const statesByAgent = activeStatesByAgent.value
    const lastTaskMap: ReadonlyMap<number, Task> = taskStore.lastTaskByAgent
    const taskCountMap = buildTaskCountByAgent(tasks.value)
    const q = query.value.trim()
    const chipFilter = chip.value
    const sortKey = sort.value

    const filtered: Agent[] = []
    for (const agent of agents.value) {
      if (!agentMatchesQuery(agent, q)) continue
      if (!agentMatchesChip(agent, chipFilter, statesByAgent, lastTaskMap)) continue
      filtered.push(agent)
    }
    filtered.sort((a, b) => compareAgents(a, b, sortKey, lastTaskMap, taskCountMap))
    return filtered
  })

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
    agents,
    tasks,
    kpiCounts,
    activeStatesByAgent,
    filteredAgents,
    state: { chip, query, sort },
    setChip,
    setQuery,
    setSort,
    ensureLoaded,
  }
}
