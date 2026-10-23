import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { api, ApiError } from '@/api/client'
import { tasksApi } from '@/api/tasks'
import { useAgentStore } from '@/stores/agent'
import type {
  Task,
  TaskDetail,
  TaskStatus,
  HistoryEntry,
  TaskErrorCode,
  TodoState,
  PendingQuestionBatch,
  AnswerTaskPayload,
} from '@/types/task'
import type { Decision } from '@/composables/useTaskChatApprovals'
import { kpiCountsFromTasks, dedupedAbortedCount } from '@/utils/dashboardKpis'

/**
 * Tasks, the active task detail view, polling, SSE updates and the task
 * operations (approve, reject, retry, continue, abort).
 *
 * The task operations await the server response and then reconcile local
 * state in place — no separate refetch — so a backend cascade (child abort
 * → parent abort) propagates without the UI racing the API.
 *
 * {@link QUIESCENT_STATUSES} lists the states where the worker is not
 * driving the task and the chat should accept a follow-up prompt.
 */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
const QUIESCENT_STATUSES: ReadonlySet<TaskStatus> = new Set(['ABORTED', 'PENDING_APPROVAL', 'AWAITING_SUB_AGENTS'])

/**
 * Slow poll cadence for AWAITING_SUB_AGENTS. The other user-driven states
 * (PENDING_APPROVAL, ABORTED) re-arm on an explicit client action, so
 * polling them is wasteful; AWAITING_SUB_AGENTS is server-driven, and
 * without this poll a parent in a Mercure-less deployment would stay stuck
 * until the user reloaded. 5s is short enough that a sub-agent round-trip
 * rarely lands outside one poll window.
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

/**
 * Mirror the wire response's top-level `pending_questions` into
 * `activeTask.data.pending_questions`, so the picker computed finds it
 * whichever transport populated the task (SSE merge, REST update, first
 * load).
 *
 * `previousPendingQuestions` covers the "incoming omits the field" case: a
 * poll that leaves `pending_questions` out must not silently clear a
 * pre-existing batch. On first load there is no prior — pass `undefined`
 * and the incoming value (or null) wins.
 */
function mirrorPendingQuestions(
  active: ActiveTaskRef,
  incoming: unknown,
  previousPendingQuestions: unknown,
): void {
  if (active.value === null) return
  const next = incoming !== undefined ? incoming : previousPendingQuestions
  if (Array.isArray(next) || next === null) {
    const existingData = active.value.data ?? {}
    active.value.data = { ...existingData, pending_questions: next }
  }
}

function applyActiveTaskUpdate(active: ActiveTaskRef, incoming: TaskDetail, getLastSequence: () => number, setLastSequence: (n: number) => void): void {
  if (active.value === null) return
  active.value.status = incoming.status
  active.value.final_response = incoming.final_response
  active.value.step_count = incoming.step_count
  active.value.updated_at = incoming.updated_at
  active.value.aborted_at = incoming.aborted_at
  // `applyDataField` wholesale-replaces `data`, so capture the pre-existing
  // `data.pending_questions` first — a poll whose response omits the field
  // must not clear a pre-existing batch.
  const previousPendingQuestions = active.value.data?.pending_questions
  applyDataField(active, incoming.data)
  mirrorPendingQuestions(active, incoming.pending_questions, previousPendingQuestions)
  // Append new history entries, filtering by sequence to guard against
  // duplicate delivery from concurrent in-flight requests.
  if (incoming.history.length > 0) {
    const newEntries = incoming.history.filter((h) => h.sequence > getLastSequence())
    if (newEntries.length > 0) {
      active.value.history.push(...newEntries)
      setLastSequence(newEntries.at(-1)!.sequence)
      // Drop the server-supplied aggregate so `TaskUsagePanel` re-derives from
      // `history` — the server doesn't recompute totals on incremental polls.
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
   * Sub-task cache for `sub_agent` rows, keyed by child task id. Read by
   * `SubAgentToolCall.vue`; filled by `fetchSubTaskDetail` and patched by
   * `applyTaskUpdate` for a non-active task id.
   *
   * `shallowRef` skips deep Proxy wrapping of the Map's entries — callers
   * mutate via `.set(...)` and then reassign a fresh Map to fire reactivity.
   */
  const subTaskCache = shallowRef<Map<number, TaskDetail>>(new Map())
  /**
   * Client-only flag set on a task row while the browser worker has a
   * `/tick` request in flight for it. The server tick is synchronous, so
   * Mercure-less deployments never see `status === 'RUNNING'` on the wire —
   * without this flag the chat has no in-flight signal between the send and
   * the tick result.
   *
   * `shallowRef` for the same reason as `subTaskCache`.
   */
  const drivingTaskIds = shallowRef<Set<number>>(new Set())
  const isDriving = computed(() => (id: number): boolean => drivingTaskIds.value.has(id))
  let listPollTimer: ReturnType<typeof setTimeout> | null = null
  let listPollGeneration = 0
  let detailPollTimer: ReturnType<typeof setTimeout> | null = null
  let abortSettlingPollTimer: ReturnType<typeof setTimeout> | null = null
  let lastSequence = 0
  // Timestamp of the last SSE update processed by applyTaskUpdate
  let lastSseUpdateAt = 0
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
      // First load — replace entirely, then mirror `pending_questions` into
      // `data.pending_questions` so the picker computed finds it on the first
      // render. Without this the picker only appears after the next polling
      // tick. There is no prior `data.pending_questions` to preserve here.
      activeTask.value = incoming
      lastSequence = Math.max(...incoming.history.map((h) => h.sequence), 0)
      mirrorPendingQuestions(activeTask, incoming.pending_questions, undefined)
      // Apply a pending SSE update that arrived before this fetch completed.
      const pendingForTask = pendingSseUpdates.get(taskId)
      if (pendingForTask !== undefined) {
        applyTaskUpdate(taskId, pendingForTask)
        pendingSseUpdates.delete(taskId)
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

  /**
   * Replace everything but the last few rows of the task's history with a
   * summary for the model.
   *
   * The summarized turns stay in the history, so the transcript is unchanged
   * — but the server appends a summary row, and the summary's sequence is
   * below the cursor a sequence-filtered merge would have. The history is
   * therefore replaced wholesale rather than merged.
   *
   * `compacted` is false when the history was too short to summarize.
   */
  async function compactTask(taskId: number): Promise<{ task: TaskDetail; compacted: boolean }> {
    const result = await api.post<{ task: TaskDetail; compacted: boolean }>(`/tasks/${taskId}/compact`)

    const active = activeTask.value
    if (active !== null && active.id === taskId) {
      activeTask.value = result.task
      lastSequence = Math.max(...result.task.history.map((h) => h.sequence), 0)
      // The picker reads `data.pending_questions`, which is mirrored from
      // the top-level field — a wholesale replace drops the mirror.
      mirrorPendingQuestions(activeTask, result.task.pending_questions, undefined)
    }

    return result
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
   * Abort the running agent loop for the given task.
   *
   * No body is sent — the user's continuation message is whatever they type
   * next, so the server has nothing to capture at the abort call itself.
   *
   * The button acknowledges the click immediately, but the chat status is not
   * patched until the server confirms: an abort that lands after the loop
   * finished naturally returns 409, and claiming ABORTED for a task that is
   * still running would lie to the user. On success the response carries the
   * post-abort task row, mirrored into the dashboard list and into
   * `activeTask` so the chat flips to the ABORTED banner without waiting for
   * SSE.
   *
   * The detail poller stays running across the abort, bounded by
   * {@link startAbortSettlingPoll}.
   */
  async function abortTask(taskId: number): Promise<Task> {
    const result = await api.post<{ task: Task }>(`/tasks/${taskId}/abort`, {})
    const aborted = result.task
    // Mirror into the dashboard list so the chip filter and KPI counter
    // reflect the abort without a refetch.
    const idx = tasks.value.findIndex((t) => t.id === aborted.id)
    if (idx !== -1) {
      const existing = tasks.value[idx]
      if (existing) tasks.value[idx] = { ...existing, ...aborted }
    }
    // Patch activeTask in place if the chat is showing the aborted task, so
    // the banner flips immediately rather than whenever SSE catches up.
    const active = activeTask.value
    if (active !== null && active.id === taskId) {
      active.status = aborted.status
      active.aborted_at = aborted.aborted_at ?? active.aborted_at
      active.updated_at = aborted.updated_at ?? active.updated_at
      // Open the bounded settling poll window so in-flight tool output the
      // worker publishes between now and the bail lands without a reload.
      startAbortSettlingPoll(taskId)
    }
    return aborted
  }

  /**
   * Abort a child sub-agent and cascade the abort up through every
   * AWAITING_SUB_AGENTS ancestor. The backend's
   * `TaskService::abortSubAgentAndCascade` aborts the child first, then walks
   * the parent chain publishing Mercure events as it goes — the chat picks up
   * the parent ABORTED transition via SSE.
   *
   * Mirrors {@link abortTask} — the post-cascade child row is mirrored into
   * `tasks[]` and `activeTask` — but opens no settling poll: the cascade's
   * own per-ancestor Mercure publishes drive the parent transitions.
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
   * Polling companion to {@link abortTask}: keeps the detail poller running
   * for ABORTED tasks just long enough to catch in-flight updates the worker
   * publishes while it bails out.
   *
   * Stop rule: two consecutive polls that see no change in `updated_at` mean
   * the worker has settled; a 60 s hard cap covers a worker that keeps
   * publishing slowly enough that the row changes on every poll.
   *
   * Runs on its own `abortSettlingPollTimer` handle, separate from the
   * regular `detailPollTimer`, so stopping one loop cannot stop the other.
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
          // Two unchanged polls in a row — the worker has settled;
          // `continueTask` re-arms later.
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
   * Fetch a child task detail into `subTaskCache`, so the component
   * re-renders reactively and SSE updates to the same child id can patch
   * the cached entry in place.
   */
  async function fetchSubTaskDetail(taskId: number): Promise<void> {
    if (subTaskCache.value.has(taskId)) return
    const result = await api.get<{ task: TaskDetail }>(`/tasks/${taskId}`)
    subTaskCache.value.set(taskId, result.task)
    // `shallowRef` skips the deep Map proxy — reassign with a fresh Map so
    // consumers reading `cache.get(id)` inside a computed re-evaluate.
    subTaskCache.value = new Map(subTaskCache.value)
  }

  /**
   * Patch a cached sub-task entry and rebroadcast so subscribers see the
   * change. Public because a setup store unwraps top-level refs —
   * `store.subTaskCache` is the Map, not the ref — so a caller cannot
   * replace it directly.
   */
  function patchSubTask(taskId: number, patch: Partial<TaskDetail>): void {
    const current = subTaskCache.value.get(taskId)
    if (current === undefined) return
    subTaskCache.value.set(taskId, { ...current, ...patch })
    subTaskCache.value = new Map(subTaskCache.value)
  }

  /**
   * Empty the sub-task cache so a later parent task visit does not show
   * child rows. Cleared on parent unmount, not per component, so several
   * sub-agent widgets share the cache.
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
   * Pre-fetch guard for the detail-poll tick: false when the active task no
   * longer matches the polled id, has reached a terminal status, or sits in a
   * user-driven state (PENDING_APPROVAL / ABORTED) that re-arms on an
   * explicit client action.
   *
   * AWAITING_SUB_AGENTS is intentionally NOT skipped: it is server-driven
   * (sub-agents complete without a user action), so the caller handles it
   * explicitly to pick the slow cadence.
   */
  function isPollableActive(taskId: number): boolean {
    const active = activeTask.value
    if (active?.id !== taskId) return false
    if (TERMINAL_STATUSES.has(active.status)) return false
    if (active.status === 'PENDING_APPROVAL' || active.status === 'ABORTED') return false
    return true
  }

  /**
   * One detail-poll cycle: fetch, then schedule the next tick at the cadence
   * for the post-fetch status. Exits silently if the fetch failed or the
   * active task changed underneath us.
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
          dashboardPollTimer = setTimeout(tick, 30_000)
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
   * SSE updates for tasks whose detail isn't loaded yet. Keyed by taskId so
   * updates for several tasks arriving back-to-back aren't trampled by a
   * single-slot overwrite; the latest payload wins for a given id. Consumed
   * by {@link fetchTaskDetail} once the matching task loads.
   */
  const pendingSseUpdates = new Map<number, Record<string, unknown>>()

  /**
   * Merge a real-time task update from SSE into `activeTask`.
   *
   * If `activeTask` is not loaded yet the update is parked as pending and
   * applied by `fetchTaskDetail` once the task loads.
   */
  function applyTaskUpdate(taskId: number, data: Record<string, unknown>): void {
    // Ignore events for a task that has already reached a terminal state
    if (activeTask.value?.id === taskId && TERMINAL_STATUSES.has(activeTask.value.status)) return
    if (activeTask.value === null) {
      // Park it until `fetchTaskDetail` loads the task.
      pendingSseUpdates.set(taskId, data)
      return
    }
    if (activeTask.value.id !== taskId) {
      // Non-active task: patch the cached entry so an open `SubAgentToolCall`
      // widget updates live without a re-fetch.
      if (subTaskCache.value.has(taskId)) {
        applySubTaskUpdate(taskId, data)
      }
      return
    }
    // Consume any pending update for this task — fetchTaskDetail already
    // applied it on load, so the live SSE merge just continues from here.
    pendingSseUpdates.delete(taskId)
    // SSE has provided fresh data — stop detail polling so SSE drives updates
    stopDetailPolling()
    lastSseUpdateAt = Date.now()
    mergeActiveTaskUpdate(data)
  }

  /**
   * Mark a task as actively being driven by the browser worker, from the
   * SharedWorker's `tick-start` message, so the chat can render the in-flight
   * spinner. The server tick is synchronous, so a Mercure-less deployment
   * never sees `status === 'RUNNING'` on the wire — this flag is the only
   * in-flight signal between the send and the tick result.
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
   * Clear the in-flight flag, from the matching `tick-result` message.
   * Idempotent — clearing an already-cleared id is a no-op.
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
    subTaskCache.value = new Map(subTaskCache.value)
  }

function mergeActiveTaskUpdate(data: Record<string, unknown>): void {
  if (activeTask.value === null) return
  const active: ActiveTaskRef = activeTask
  applyScalarFields(active, data)
  // Merge the Mercure-published `tasks.data` JSON column (carries `todos`
  // for TodoTool, `spawned_sub_task_ids` / `handover` for the handover tool)
  // onto activeTask.value.data without replacing sibling keys the chat may
  // already be reading. `pending_questions` is parked on `tasks.pending_state`
  // on the backend and rides on the SSE event's top level — NOT in
  // `tasks.data` — so any stale key that sneaks into `data.data` is stripped
  // and the explicit handler below keeps authority for it. This branch must
  // sit BEFORE that handler so its overlay lands last.
  if (data.data !== undefined && data.data !== null && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const incoming: Record<string, unknown> = { ...(data.data as Record<string, unknown>) }
    delete incoming.pending_questions
    const baseData = activeTask.value.data
    const baseIsObject = baseData !== null && baseData !== undefined && typeof baseData === 'object' && !Array.isArray(baseData)
    activeTask.value.data = baseIsObject ? { ...(baseData as Record<string, unknown>), ...incoming } : { ...incoming }
  }
  mergeHistory(active, () => lastSequence, (n) => { lastSequence = n }, data)
  if (Array.isArray(data.tool_calls)) {
    activeTask.value.tool_calls = data.tool_calls as TaskDetail['tool_calls']
  }
  applyErrorFields(active, data)
  applyRetryFields(active, data)
  // `pending_questions` rides on the top level of the Mercure event payload —
  // push it into `data` without replacing sibling keys the chat may already
  // be reading (e.g. `spawned_sub_task_ids`, `handover`).
  if (Array.isArray(data.pending_questions) || data.pending_questions === null) {
    const existingData = activeTask.value.data ?? {}
    activeTask.value.data = { ...existingData, pending_questions: data.pending_questions }
  }
}

  const pendingToolCalls = computed(() => {
    const calls = activeTask.value?.tool_calls
    return Array.isArray(calls) ? calls.filter((tc) => tc.status === 'PENDING_APPROVAL') : []
  })

  const isTerminal = computed(() =>
    activeTask.value !== null && TERMINAL_STATUSES.has(activeTask.value.status),
  )

  /** All tasks grouped by agent_id. */
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
   * Per-agent set of currently-active (non-terminal) task states. One agent
   * can be in several states at once when its tasks span tabs — the dashboard
   * surfaces both pills rather than collapsing to one.
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
   * Task-level aggregate counts across the user's whole fleet, powering the
   * dashboard KPI cards. Deduplicated by agent_id: a group-shared agent
   * surfaces every member's run, so the raw list would count one shared
   * conversation once per member.
   */
  const kpiCounts = computed(() => kpiCountsFromTasks(tasks.value))

  /**
   * Number of distinct agents with an ABORTED conversation, surfaced through
   * the ABORTED dashboard chip. Deduplicated by agent_id for the same reason
   * as {@link kpiCounts}; an aborted task belongs to neither the running nor
   * the awaiting bucket.
   */
  const abortedCount = computed(() => dedupedAbortedCount(tasks.value))

  /**
   * Live todo state for the active task, sourced from `task.data.todos` so
   * the panel, the compact strip and the per-row tool-call card share one
   * source. `null` when the task has no todos yet, or has just been cleared.
   */
  const pendingTodos = computed<TodoState | null>(() => {
    const raw = activeTask.value?.data?.todos
    if (raw === null || raw === undefined) return null
    if (typeof raw !== 'object') return null
    const candidate = raw as Partial<TodoState>
    if (!Array.isArray(candidate.items)) return null
    return {
      version: typeof candidate.version === 'number' ? candidate.version : 1,
      items: candidate.items,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    }
  })

  /**
   * Outstanding `ask_user_question` batches parked on the active task. The
   * chat surfaces the first batch; when the backend reports several (the
   * status stays AWAITING_INPUT until every batch is answered), the picker
   * stays open for the next one. `null` when nothing is pending.
   */
  const pendingQuestions = computed<PendingQuestionBatch[] | null>(() => {
    const raw = activeTask.value?.data?.pending_questions
    if (!Array.isArray(raw)) return null
    return raw as PendingQuestionBatch[]
  })

  /**
   * Submit a batched answer for the first outstanding `ask_user_question`
   * batch on the active task. The answer response carries the updated task
   * resource, so it is applied directly instead of issuing a follow-up GET —
   * one HTTP round-trip per submit, and the picker stays in lockstep with
   * the backend.
   *
   * Errors propagate to the caller, which wires them into its toast surface.
   */
  async function answerPendingQuestions(payload: AnswerTaskPayload): Promise<void> {
    if (activeTask.value === null) {
      throw new ApiError('No active task to answer.', 'NO_ACTIVE_TASK', 0)
    }
    const taskId = activeTask.value.id
    const { task } = await tasksApi.answerTask(taskId, payload)
    applyActiveTaskUpdate(activeTask, task, () => lastSequence, (n) => { lastSequence = n })
  }

  return {
    tasks,
    activeTask,
    subTaskCache,
    drivingTaskIds,
    isDriving,
    pendingToolCalls,
    pendingTodos,
    pendingQuestions,
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
    compactTask,
    continueTask,
    abortTask,
    abortSubAgent,
    cancelRetryChain,
    answerPendingQuestions,
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
    patchSubTask,
  }
})
