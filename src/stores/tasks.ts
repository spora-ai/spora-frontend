import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, ApiError } from '@/api/client'
import { useAgentStore } from '@/stores/agent'
import type { Task, TaskDetail, TaskStatus, HistoryEntry, TaskErrorCode } from '@/types/task'
import type { Decision } from '@/composables/useTaskChatApprovals'
import { kpiCountsFromTasks, dedupedAbortedCount } from '@/utils/dashboardKpis'

/**
 * Manages tasks, active task detail view, polling for updates,
 * SSE-driven real-time updates, and task operations (approve, reject, retry, continue, abort).
 *
 * The `abortTask` action does NOT optimistic-update: like approve/reject,
 * it awaits the server response, then mirrors the post-abort row into
 * both `tasks[]` (for the dashboard chip/KPI) and `activeTask` (for the
 * chat banner) in place — no separate refetch. The companion
 * {@link startAbortSettlingPoll} keeps the detail poller alive for the
 * transition window. The chat follows the `useTaskChatApprovals`
 * pattern — submit a flag, await the response, reconcile — so a backend
 * cascade (child abort → parent abort) propagates without the UI racing
 * the API. Errors surface as toasts from the chat page.
 *
 * {@link QUIESCENT_STATUSES} is the set of states where the worker is
 * not driving the task and the chat should accept a follow-up prompt.
 * The detail poller skips quiescent tasks so we don't waste cycles
 * fetching a task that's waiting on the user.
 */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
const QUIESCENT_STATUSES: ReadonlySet<TaskStatus> = new Set(['ABORTED', 'PENDING_APPROVAL', 'AWAITING_SUB_AGENTS'])

/**
 * Slow poll cadence used while a task is AWAITING_SUB_AGENTS. The other
 * quiescent states (PENDING_APPROVAL, ABORTED) have explicit client-side
 * re-arm paths (user clicks approve/reject, {@link startAbortSettlingPoll}),
 * so polling for them is wasteful. AWAITING_SUB_AGENTS is server-driven —
 * sub-agents complete without any user action — so without this slow
 * poll, a parent in a Mercure-less (polling-only) deployment would stay
 * stuck on AWAITING_SUB_AGENTS until the user reloaded. 5s is responsive
 * enough that a sub-agent roundtrip rarely lands outside one poll window,
 * while still cheap enough that the request volume stays bounded.
 */
const AWAITING_SUB_AGENTS_POLL_INTERVAL_MS = 5_000

async function cancelRetryChain(taskId: number): Promise<void> {
  await api.delete(`/tasks/${taskId}/retry-chain`)
}

type ActiveTaskRef = { value: TaskDetail | null }

function applyScalarFields(active: ActiveTaskRef, data: Record<string, unknown>): void {
  if (active.value === null) return
  if (data.status !== undefined) active.value.status = data.status as TaskStatus
  if (data.final_response !== undefined) active.value.final_response = data.final_response as string | null
  if (data.step_count !== undefined) active.value.step_count = data.step_count as number
  if (data.updated_at !== undefined) active.value.updated_at = data.updated_at as string
  if (data.aborted_at !== undefined) active.value.aborted_at = data.aborted_at as string | null
}

function applyDataField(active: ActiveTaskRef, data: TaskDetail['data'] | undefined): void {
  if (active.value === null || data === undefined) return
  active.value.data = data
}

function mergeHistory(active: ActiveTaskRef, getLastSequence: () => number, setLastSequence: (n: number) => void, data: Record<string, unknown>): void {
  if (active.value === null) return
  if (!Array.isArray(data.history)) return
  const lastSeq = getLastSequence()
  const newEntries = (data.history as unknown as HistoryEntry[]).filter(h => h.sequence > lastSeq)
  if (newEntries.length === 0) return
  active.value.history.push(...newEntries)
  setLastSequence(newEntries.at(-1)!.sequence)
}

function applyActiveTaskUpdate(active: ActiveTaskRef, incoming: TaskDetail, getLastSequence: () => number, setLastSequence: (n: number) => void): void {
  if (active.value === null) return
  active.value.status = incoming.status
  active.value.final_response = incoming.final_response
  active.value.step_count = incoming.step_count
  active.value.updated_at = incoming.updated_at
  active.value.aborted_at = incoming.aborted_at
  applyDataField(active, incoming.data)
  // Append new history entries, filtering by sequence to guard against
  // duplicate delivery from concurrent in-flight requests.
  if (incoming.history.length > 0) {
    const newEntries = incoming.history.filter((h) => h.sequence > getLastSequence())
    if (newEntries.length > 0) {
      active.value.history.push(...newEntries)
      setLastSequence(newEntries.at(-1)!.sequence)
      // Drop the server-supplied aggregate so TaskUsagePanel re-derives
      // from `history`. Without this, the panel's headline stays stuck at
      // the first-fetch value (the server doesn't recompute totals on
      // incremental polls, and we don't want to second-guess its rules
      // here — see Bug B in the PR).
      active.value.totals = null
    }
  }
  // Refresh tool_calls on every poll (status may change on resume)
  active.value.tool_calls = incoming.tool_calls
}

function applyErrorFields(active: ActiveTaskRef, data: Record<string, unknown>): void {
  if (active.value === null) return
  if (data.error_code !== undefined) active.value.error_code = data.error_code as TaskErrorCode | null
  if (data.error_message !== undefined) active.value.error_message = data.error_message as string | null
}

function applyRetryFields(active: ActiveTaskRef, data: Record<string, unknown>): void {
  if (active.value === null) return
  if (data.retry_of_task_id !== undefined) active.value.retry_of_task_id = data.retry_of_task_id as number | null
  if (data.retry_count !== undefined) active.value.retry_count = data.retry_count as number | undefined
  if (data.retry_after !== undefined) active.value.retry_after = data.retry_after as string | null
}

export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const activeTask = ref<TaskDetail | null>(null)
  /**
   * Sub-task cache for `sub_agent` rows. Keyed by child task id; values are
   * full TaskDetail rows fetched from the API and read by `SubAgentToolCall.vue`.
   * Updated by:
   *   - `fetchSubTaskDetail(id)` — initial fetch on mount
   *   - `applyTaskUpdate(id, data)` — SSE event for a non-active task id
   */
  const subTaskCache = ref<Map<number, TaskDetail>>(new Map())
  /**
   * Client-only flag set on a task row while the browser worker has a
   * `/tick` request in flight for it. The server tick is synchronous,
   * so Mercure-less deployments (the typical shared-host path) never
   * see `status === 'RUNNING'` on the wire — without this flag the
   * chat has no in-flight signal between "user clicked Send" and "tick
   * returned with status=COMPLETED". Set by `markDriving(id)` from the
   * SharedWorker's `tick-start` message, cleared by `clearDriving(id)`
   * on `tick-result`. The `TaskChatMessageList` indicator treats this
   * flag as equivalent to `status === 'RUNNING'` for spinner rendering.
   */
  const drivingTaskIds = ref<Set<number>>(new Set())
  const isDriving = computed(() => (id: number): boolean => drivingTaskIds.value.has(id))
  let listPollTimer: ReturnType<typeof setTimeout> | null = null
  let listPollGeneration = 0
  let detailPollTimer: ReturnType<typeof setTimeout> | null = null
  let abortSettlingPollTimer: ReturnType<typeof setTimeout> | null = null
  let lastSequence = 0
  // Timestamp of the last SSE update processed by applyTaskUpdate (monotonic clock in ms)
  let lastSseUpdateAt = 0
  // Dashboard polling handles
  let dashboardPollTimer: ReturnType<typeof setTimeout> | null = null
  let dashboardPollGen = 0
  let lastDashboardPollAt: string | null = null

  async function fetchTasks(): Promise<void> {
    const result = await api.get<{ tasks: Task[] }>('/tasks')
    tasks.value = result.tasks
  }

  async function createTaskForAgent(
    agentId: number,
    prompt: string,
    parentTaskId?: number,
    mediaIds: string[] = [],
  ): Promise<Task> {
    const payload: Record<string, unknown> = { agent_id: agentId, prompt }
    if (parentTaskId !== undefined) {
      payload.parent_task_id = parentTaskId
    }
    if (mediaIds.length > 0) {
      payload.media_ids = mediaIds
    }
    const result = await api.post<{ task: Task }>('/tasks', payload)
    return result.task
  }

  async function fetchTaskDetail(taskId: number, sinceSequence?: number): Promise<boolean> {
    const query = sinceSequence === undefined ? '' : `?since_sequence=${sinceSequence}`
    let result: { task: TaskDetail }
    try {
      result = await api.get<{ task: TaskDetail }>(`/tasks/${taskId}${query}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        activeTask.value = null
        return false
      }
      throw e
    }
    const incoming = result.task

    if (activeTask.value?.id === taskId) {
      applyActiveTaskUpdate(activeTask, incoming, () => lastSequence, (n) => { lastSequence = n })
      // If the row landed on a terminal status, clear the SPA-side
      // "driving" flag too — the next `/tick` won't fire for this row,
      // and a lost tick-result (page nav mid-tick) would otherwise
      // leave the spinner spinning forever.
      if (TERMINAL_STATUSES.has(incoming.status) && drivingTaskIds.value.has(taskId)) {
        drivingTaskIds.value.delete(taskId)
        drivingTaskIds.value = new Set(drivingTaskIds.value)
      }
    } else {
      // First load — replace entirely, then apply any pending SSE update for this task
      activeTask.value = incoming
      lastSequence = Math.max(...incoming.history.map((h) => h.sequence), 0)
      // Apply pending SSE update if we have one for this task (handles race where SSE
      // event arrived before fetchTaskDetail completed)
      if (pendingSseUpdate !== null && pendingSseUpdate.taskId === taskId) {
        applyTaskUpdate(taskId, pendingSseUpdate.data)
        pendingSseUpdate = null
      }
    }
    return true
  }

  async function approveTask(taskId: number, decisions: Decision[]): Promise<void> {
    const snakeCaseDecisions = decisions.map(decision => ({
      provider_call_id: decision.providerCallId,
      decision: decision.decision,
      ...(decision.arguments !== undefined ? { arguments: decision.arguments } : {}),
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
    }))
    await api.post(`/tasks/${taskId}/approve`, { decisions: snakeCaseDecisions })
    await fetchTaskDetail(taskId)
  }

  async function retryTask(taskId: number): Promise<Task> {
    const result = await api.post<{ task: Task }>(`/tasks/${taskId}/retry`)
    return result.task
  }

  async function continueTask(
    taskId: number,
    prompt: string,
    additionalSteps?: number,
    mediaIds: string[] = [],
  ): Promise<Task> {
    const body: Record<string, unknown> = { prompt }
    if (additionalSteps !== undefined) {
      body.additional_steps = additionalSteps
    }
    if (mediaIds.length > 0) {
      body.media_ids = mediaIds
    }
    const result = await api.post<{ task: Task }>(`/tasks/${taskId}/continue`, body)
    return result.task
  }

  /**
   * Abort the running agent loop for the given task. No body is sent —
   * the user's continuation message is whatever they type next, so the
   * server has nothing to capture at the abort call itself.
   *
   * The button gives immediate click acknowledgement (label flips to
   * "Aborting…"), but the chat status is intentionally NOT patched
   * until the server confirms: an abort that lands after the loop
   * finished naturally returns 409, and we must not lie to the user
   * by claiming ABORTED status for a task that is still running or
   * already complete. On success the response carries the post-abort
   * task row; we mirror it into the dashboard list (`tasks`) AND into
   * `activeTask` (so the chat flips to the ABORTED banner the moment
   * the server says so, without waiting on SSE).
   *
   * The detail poller stays running across the abort, but it is
   * bounded by {@link startAbortSettlingPoll}: once the worker bails
   * the row's `updated_at` stops changing, two consecutive unchanged
   * polls stop the loop, and a 60 s hard cap catches anything missed.
   * Without the bound the user reported polling forever — which is
   * technically harmless but wasteful and keeps the request going
   * long after the worker has settled.
   */
  async function abortTask(taskId: number): Promise<Task> {
    const result = await api.post<{ task: Task }>(`/tasks/${taskId}/abort`, {})
    const aborted = result.task
    // Mirror the response into the dashboard list (`tasks`) so the chip filter
    // and KPI counter reflect the abort without a refetch.
    const idx = tasks.value.findIndex((t) => t.id === aborted.id)
    if (idx !== -1) {
      const existing = tasks.value[idx]
      if (existing) tasks.value[idx] = { ...existing, ...aborted }
    }
    // Patch activeTask in place if the chat is currently showing the
    // aborted task — the chat flips to the ABORTED banner immediately,
    // not whenever SSE catches up. Skip when activeTask is unrelated
    // (e.g. aborting a sub-agent whose chat isn't open) or absent.
    const active = activeTask.value
    if (active !== null && active.id === taskId) {
      active.status = aborted.status
      active.aborted_at = aborted.aborted_at ?? active.aborted_at
      active.updated_at = aborted.updated_at ?? active.updated_at
      // Open the bounded settling poll window so any in-flight tool
      // output the worker publishes between now and the bail lands in
      // the chat without a page reload.
      startAbortSettlingPoll(taskId)
    }
    return aborted
  }

  /**
   * Abort a child sub-agent and cascade the abort up through every
   * AWAITING_SUB_AGENTS ancestor. The backend's
   * `TaskService::abortSubAgentAndCascade` aborts the child first, then
   * walks the parent chain publishing Mercure events as it goes — the
   * chat picks up the parent ABORTED transition via SSE through
   * `applyTaskUpdate` once the cascade finishes.
   *
   * Behaviour mirrors {@link abortTask}: mirror the post-cascade child
   * row into `tasks[]` for the dashboard chip/KPI, and patch
   * `activeTask` in place if the chat is currently showing that child.
   * Unlike `abortTask`, the bounded settling poll is intentionally NOT
   * opened here — the parent publishing is driven by the cascade's own
   * per-ancestor Mercure publishes, not by settling-poll retries on the
   * child row. Keep it simple: this is a one-shot server-authoritative
   * flip, same as `abortTask` was.
   */
  async function abortSubAgent(childTaskId: number): Promise<Task> {
    const result = await api.post<{ task: Task }>(`/tasks/${childTaskId}/abort-sub-agent`, {})
    const aborted = result.task
    const idx = tasks.value.findIndex((t) => t.id === aborted.id)
    if (idx !== -1) {
      const existing = tasks.value[idx]
      if (existing) tasks.value[idx] = { ...existing, ...aborted }
    }
    const active = activeTask.value
    if (active !== null && active.id === childTaskId) {
      active.status = aborted.status
      active.aborted_at = aborted.aborted_at ?? active.aborted_at
      active.updated_at = aborted.updated_at ?? active.updated_at
    }
    return aborted
  }

  /**
   * Polling companion to {@link abortTask}: keeps the detail poller
   * running for ABORTED tasks just long enough to catch in-flight
   * updates the worker publishes while it's bailing out, then stops.
   *
   * Stop rule: two consecutive polls that see no change in `updated_at`
   * mean the worker has settled. A 60 s hard cap covers the rare case
   * where the worker keeps publishing slowly enough that the row
   * changes on every poll (e.g. a long tool) and a fixed-time cap is
   * the only way to bound the loop.
   *
   * Interaction with SSE: SSE continues to drive normal updates; this
   * poll loop is just the safety net for the ABORTED transition. If
   * SSE delivers before the first poll, the loop bails immediately.
   *
   * Timer slot: this loop runs on its own `abortSettlingPollTimer`
   * handle, separate from the regular `detailPollTimer`. The two share
   * the same `fetchTaskDetail` call site but must not stomp on each
   * other — `clearActiveTask` (or any other caller) needs to be able
   * to stop the settling loop without touching the regular detail
   * poll, and vice-versa.
   */
  function startAbortSettlingPoll(taskId: number): void {
    stopAbortSettlingPoll()
    const POLL_INTERVAL_MS = 2_000
    const HARD_CAP_MS = 60_000
    const SETTLED_POLLS = 2
    const startedAt = Date.now()
    let lastUpdatedAt = activeTask.value?.updated_at ?? null
    let unchangedCount = 0

    const tick = async (): Promise<void> => {
      if (activeTask.value?.id !== taskId) return
      if (TERMINAL_STATUSES.has(activeTask.value.status)) return
      // Hard cap: even if the worker keeps producing slowly, we
      // surrender after a minute — by then any abort-relevant output
      // has long since landed and a runaway poll wastes cycles.
      if (Date.now() - startedAt >= HARD_CAP_MS) {
        stopAbortSettlingPoll()
        return
      }
      const ok = await fetchTaskDetail(taskId, lastSequence)
      if (!ok) return
      const newUpdatedAt = activeTask.value?.updated_at ?? null
      if (newUpdatedAt === lastUpdatedAt) {
        unchangedCount += 1
        if (unchangedCount >= SETTLED_POLLS) {
          // Two unchanged polls in a row — worker is settled. Stop
          // polling; the user can continueTask to re-arm later.
          stopAbortSettlingPoll()
          return
        }
      } else {
        lastUpdatedAt = newUpdatedAt
        unchangedCount = 0
      }
      abortSettlingPollTimer = setTimeout(tick, POLL_INTERVAL_MS)
    }
    abortSettlingPollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  function stopAbortSettlingPoll(): void {
    if (abortSettlingPollTimer !== null) {
      clearTimeout(abortSettlingPollTimer)
      abortSettlingPollTimer = null
    }
  }

  async function rejectTask(taskId: number, reason: string): Promise<void> {
    await api.post(`/tasks/${taskId}/reject`, { reason })
    await fetchTaskDetail(taskId)
  }

  async function fetchTask(taskId: number): Promise<Task> {
    const result = await api.get<{ task: Task }>(`/tasks/${taskId}`)
    if (activeTask.value?.id === taskId) {
      // Refresh scalar fields from the fetched task
      activeTask.value.status = result.task.status
      activeTask.value.final_response = result.task.final_response
      activeTask.value.step_count = result.task.step_count
      activeTask.value.updated_at = result.task.updated_at
      activeTask.value.error_code = result.task.error_code
      activeTask.value.error_message = result.task.error_message
    }
    return result.task
  }

  /**
   * Fetch a child task detail used by `SubAgentToolCall`. The result is
   * stored in `subTaskCache` so the component can re-render reactively
   * and so SSE updates to the same child id can patch the cached entry
   * in place.
   */
  async function fetchSubTaskDetail(taskId: number): Promise<void> {
    if (subTaskCache.value.has(taskId)) return
    const result = await api.get<{ task: TaskDetail }>(`/tasks/${taskId}`)
    subTaskCache.value.set(taskId, result.task)
  }

  /**
   * Empty the sub-task cache so a future parent task visit does not leak
   * child rows. Cleared on parent TaskChatPage unmount, not on per-component
   * unmount, so multiple sub-agent widgets share the cache.
   */
  function clearSubTaskCache(): void {
    subTaskCache.value = new Map()
  }

  function startListPolling(): void {
    const gen = ++listPollGeneration
    if (listPollTimer !== null) {
      clearTimeout(listPollTimer)
      listPollTimer = null
    }
    const tick = async () => {
      if (listPollGeneration !== gen) return
      try {
        await fetchTasks()
      } finally {
        if (listPollGeneration === gen) {
          const hasActive = tasks.value.some((t) => !TERMINAL_STATUSES.has(t.status))
          listPollTimer = setTimeout(tick, hasActive ? 3000 : 10000)
        }
      }
    }
    listPollTimer = setTimeout(tick, 3000)
  }

  function stopListPolling(): void {
    listPollGeneration++
    if (listPollTimer !== null) {
      clearTimeout(listPollTimer)
      listPollTimer = null
    }
  }

  function startDetailPolling(taskId: number): void {
    // Skip polling if SSE provided data within the last 3 seconds — SSE will drive updates
    if (Date.now() - lastSseUpdateAt < 3000) return
    stopDetailPolling()
    detailPollTimer = setTimeout(() => { void detailPollTick(taskId) }, 2000)
  }

  /**
   * Pre-fetch guard for the detail-poll tick. Returns false when the
   * active task no longer matches the polled id, has reached a terminal
   * status, or sits in a user-driven quiescent state (PENDING_APPROVAL
   * / ABORTED) where polling is genuinely wasted — those states have
   * explicit client-side re-arm paths (user clicks approve/reject,
   * {@link startAbortSettlingPoll}) so no tick should fire.
   *
   * AWAITING_SUB_AGENTS is intentionally NOT in the skip set: it's
   * server-driven (sub-agents complete without a user action), so the
   * caller needs to handle it explicitly to pick the slow cadence.
   */
  function isPollableActive(taskId: number): boolean {
    const active = activeTask.value
    if (active?.id !== taskId) return false
    if (TERMINAL_STATUSES.has(active.status)) return false
    if (active.status === 'PENDING_APPROVAL' || active.status === 'ABORTED') return false
    return true
  }

  /**
   * One detail-poll cycle. Fetches, then schedules the next tick at the
   * cadence appropriate for the post-fetch status. Exits silently if
   * the fetch failed or the active task changed underneath us.
   */
  async function detailPollTick(taskId: number): Promise<void> {
    if (!isPollableActive(taskId)) return
    const ok = await fetchTaskDetail(taskId, lastSequence)
    if (!ok) return
    if (activeTask.value?.id !== taskId) return
    const next = activeTask.value.status
    if (TERMINAL_STATUSES.has(next)) return
    if (next === 'PENDING_APPROVAL' || next === 'ABORTED') return
    const intervalMs = next === 'AWAITING_SUB_AGENTS'
      ? AWAITING_SUB_AGENTS_POLL_INTERVAL_MS
      : 2000
    detailPollTimer = setTimeout(() => { void detailPollTick(taskId) }, intervalMs)
  }

  function stopDetailPolling(): void {
    if (detailPollTimer !== null) {
      clearTimeout(detailPollTimer)
      detailPollTimer = null
    }
  }

  /**
   * Merge a real-time task update from SSE into the tasks[] array (Dashboard).
   * Mirrors applyTaskUpdate but operates on tasks.value instead of activeTask.
   */
  function applySseEventToTasks(data: Record<string, unknown>): void {
    const taskId = (data.id ?? data.task_id) as number | undefined
    if (taskId === undefined) return
    const idx = tasks.value.findIndex((t) => t.id === taskId)
    if (idx !== -1) {
      Object.assign(tasks.value[idx], {
        status: (data.status as Task['status']) ?? tasks.value[idx].status,
        step_count: (data.step_count as number) ?? tasks.value[idx].step_count,
        final_response: (data.final_response as string | null) ?? tasks.value[idx].final_response,
        updated_at: (data.updated_at as string) ?? tasks.value[idx].updated_at,
      })
    } else if (data.status !== undefined) {
      tasks.value.unshift({
        id: taskId,
        agent_id: (data as { agent_id?: number }).agent_id ?? 0,
        status: data.status as Task['status'],
        user_prompt: (data as { user_prompt?: string }).user_prompt ?? '',
        final_response: (data.final_response as string | null) ?? null,
        step_count: (data.step_count as number) ?? 0,
        max_steps: null,
        created_at: (data.created_at as string) ?? new Date().toISOString(),
        updated_at: (data.updated_at as string) ?? new Date().toISOString(),
      })
    }
  }

  function startDashboardPolling(): void {
    const gen = ++dashboardPollGen
    if (dashboardPollTimer !== null) {
      clearTimeout(dashboardPollTimer)
      dashboardPollTimer = null
    }
    const tick = async () => {
      if (dashboardPollGen !== gen) return
      try {
        const query = lastDashboardPollAt ? `?since=${encodeURIComponent(lastDashboardPollAt)}` : ''
        const result = await api.get<{ tasks: Task[]; server_time: string }>(`/tasks${query}`)
        if (!result || !Array.isArray(result.tasks)) return
        // Merge: update existing tasks, prepend new ones
        for (const t of result.tasks) {
          const idx = tasks.value.findIndex((x) => x.id === t.id)
          if (idx === -1) {
            tasks.value.unshift(t)
          } else {
            tasks.value[idx] = t
          }
        }
        if (result.server_time) {
          lastDashboardPollAt = result.server_time
        }
        // Also sync with agentStore.currentAgentTasks so AgentPage picks up new tasks
        const agentStore = useAgentStore()
        for (const t of result.tasks) {
          agentStore.applySseTaskEvent({ ...t })
        }
      } catch {
        // Network or API error — keep polling, don't crash
      } finally {
        if (dashboardPollGen === gen) {
          dashboardPollTimer = setTimeout(tick, 30_000) // every 30s
        }
      }
    }
    dashboardPollTimer = setTimeout(tick, 30_000)
  }

  function stopDashboardPolling(): void {
    dashboardPollGen++
    if (dashboardPollTimer !== null) {
      clearTimeout(dashboardPollTimer)
      dashboardPollTimer = null
    }
  }

  function clearActiveTask(): void {
    stopDetailPolling()
    stopAbortSettlingPoll()
    activeTask.value = null
    lastSequence = 0
  }

  /**
   * Pending SSE update stored when activeTask is not yet loaded.
   * Used to apply the first SSE event when fetchTaskDetail hasn't completed yet.
   */
  let pendingSseUpdate: { taskId: number; data: Record<string, unknown> } | null = null

  /**
   * Merge a real-time task update from SSE into activeTask.
   * Used by useRealtime when Mercure pushes a task/* event.
   *
   * If activeTask is not yet loaded (null or different taskId), the update is stored
   * as pending and applied once the correct task is loaded via fetchTaskDetail.
   */
  function applyTaskUpdate(taskId: number, data: Record<string, unknown>): void {
    // Ignore events for a task that has already reached a terminal state
    if (activeTask.value?.id === taskId && TERMINAL_STATUSES.has(activeTask.value.status)) return
    if (activeTask.value === null) {
      // Store as pending — will be applied by fetchTaskDetail once activeTask is set
      pendingSseUpdate = { taskId, data }
      return
    }
    if (activeTask.value.id !== taskId) {
      // Non-active task: if it is in the sub-task cache, patch the
      // cached entry so an open `SubAgentToolCall` widget updates live
      // without a re-fetch.
      if (subTaskCache.value.has(taskId)) {
        applySubTaskUpdate(taskId, data)
      }
      return
    }
    // Apply pending update if this is the right task
    if (pendingSseUpdate?.taskId === taskId) pendingSseUpdate = null
    // SSE has provided fresh data — stop detail polling so SSE drives updates
    stopDetailPolling()
    lastSseUpdateAt = Date.now()
    mergeActiveTaskUpdate(data)
  }

  /**
   * Mark a task as actively being driven by the browser worker. Called
   * from the SharedWorker's `tick-start` message — the SPA flips the
   * flag for the duration of the `/tick` HTTP request so the chat can
   * render the in-flight spinner. Idempotent: re-marking an already-
   * driving task is a no-op so a second tick-start for the same row
   * (concurrent loop iterations before the first response lands) does
   * not confuse Vue's reactivity.
   */
  function markDriving(taskId: number): void {
    if (!drivingTaskIds.value.has(taskId)) {
      drivingTaskIds.value.add(taskId)
      // `Set` mutation is not reactive by default; trigger a re-read by
      // replacing with a fresh Set so dependents (the indicator template)
      // re-evaluate.
      drivingTaskIds.value = new Set(drivingTaskIds.value)
    }
  }

  /**
   * Clear the in-flight flag. Called on the matching `tick-result`
   * message. Idempotent — clearing an already-cleared id is a no-op.
   * Also clears the flag when the task reaches a terminal status so
   * the spinner hides even if a `tick-result` is lost to a network
   * error mid-flight.
   */
  function clearDriving(taskId: number): void {
    if (drivingTaskIds.value.has(taskId)) {
      drivingTaskIds.value.delete(taskId)
      drivingTaskIds.value = new Set(drivingTaskIds.value)
    }
  }

  function applySubTaskUpdate(taskId: number, data: Record<string, unknown>): void {
    const cached = subTaskCache.value.get(taskId)
    if (cached === undefined) return
    if (TERMINAL_STATUSES.has(cached.status)) return
    if (data.status !== undefined) cached.status = data.status as TaskStatus
    if (data.final_response !== undefined) cached.final_response = data.final_response as string | null
    if (data.step_count !== undefined) cached.step_count = data.step_count as number
    if (data.updated_at !== undefined) cached.updated_at = data.updated_at as string
    if (data.data !== undefined) cached.data = data.data as TaskDetail['data']
    if (data.error_code !== undefined) cached.error_code = data.error_code as TaskErrorCode | null
    if (data.error_message !== undefined) cached.error_message = data.error_message as string | null
    subTaskCache.value.set(taskId, cached)
  }

  function mergeActiveTaskUpdate(data: Record<string, unknown>): void {
    if (activeTask.value === null) return
    const active: ActiveTaskRef = activeTask
    applyScalarFields(active, data)
    applyDataField(active, data.data as TaskDetail['data'] | undefined)
    mergeHistory(active, () => lastSequence, (n) => { lastSequence = n }, data)
    if (Array.isArray(data.tool_calls)) {
      activeTask.value.tool_calls = data.tool_calls as TaskDetail['tool_calls']
    }
    applyErrorFields(active, data)
    applyRetryFields(active, data)
  }

  const pendingToolCalls = computed(() => {
    const calls = activeTask.value?.tool_calls
    return Array.isArray(calls) ? calls.filter((tc) => tc.status === 'PENDING_APPROVAL') : []
  })

  const isTerminal = computed(() =>
    activeTask.value !== null && TERMINAL_STATUSES.has(activeTask.value.status),
  )

  /** All tasks grouped by agent_id, sorted by updated_at desc */
  const tasksByAgent = computed(() => {
    const map = new Map<number, Task[]>()
    for (const task of tasks.value) {
      if (!map.has(task.agent_id)) {
        map.set(task.agent_id, [])
      }
      map.get(task.agent_id)!.push(task)
    }
    return map
  })

  /** Most recent task per agent (by updated_at) */
  const lastTaskByAgent = computed(() => {
    const map = new Map<number, Task>()
    for (const task of tasks.value) {
      const existing = map.get(task.agent_id)
      if (!existing || new Date(task.updated_at) > new Date(existing.updated_at)) {
        map.set(task.agent_id, task)
      }
    }
    return map
  })

  /**
   * Per-agent set of currently-active (non-terminal) task states. A single agent
   * can be in multiple states simultaneously when its tasks span tabs/agents —
   * the dashboard surfaces both pills rather than collapsing to one.
   */
  const activeStatesByAgent = computed(() => {
    const map = new Map<number, Set<TaskStatus>>()
    for (const t of tasks.value) {
      if (TERMINAL_STATUSES.has(t.status)) continue
      let set = map.get(t.agent_id)
      if (!set) { set = new Set(); map.set(t.agent_id, set) }
      set.add(t.status)
    }
    return map
  })

  /**
   * Task-level aggregate counts across the user's whole fleet. Powers the
   * "Running: N" and "Awaiting: N" KPI cards on the dashboard. Deduplicated
   * by agent_id (post-0073: group-shared agents surface every member's run,
   * so the raw list would double-count a single shared RUNNING conversation
   * as "Running: N" across N members). One conversation per agent — that
   * matches the operator mental model.
   */
  const kpiCounts = computed(() => kpiCountsFromTasks(tasks.value))

  /**
   * Number of distinct agents with an ABORTED conversation. Surfaced
   * through the ABORTED dashboard chip (`useDashboardData`) so operators
   * can find every conversation that was halted mid-flight and now needs
   * a follow-up prompt to resume. Deduplicated by agent_id for the same
   * reason as {@link kpiCounts} above. Distinct from `runningTasks` /
   * `awaitingTasks`: an aborted task belongs to neither bucket and
   * rolling it into either would lose information at the dashboard level.
   */
  const abortedCount = computed(() => dedupedAbortedCount(tasks.value))

  return {
    tasks,
    activeTask,
    subTaskCache,
    drivingTaskIds,
    isDriving,
    pendingToolCalls,
    isTerminal,
    tasksByAgent,
    lastTaskByAgent,
    activeStatesByAgent,
    kpiCounts,
    abortedCount,
    fetchTasks,
    createTaskForAgent,
    fetchTaskDetail,
    fetchTask,
    fetchSubTaskDetail,
    clearSubTaskCache,
    approveTask,
    rejectTask,
    retryTask,
    continueTask,
    abortTask,
    abortSubAgent,
    cancelRetryChain,
    startListPolling,
    stopListPolling,
    startDetailPolling,
    stopDetailPolling,
    clearActiveTask,
    applyTaskUpdate,
    applySseEventToTasks,
    startDashboardPolling,
    stopDashboardPolling,
    markDriving,
    clearDriving,
  }
})
