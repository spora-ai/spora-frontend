import type { Task, TaskStatus } from '@/types/task'

/**
 * KPI counts surfaced through the dashboard's top-of-page chips.
 * `runningTasks` and `awaitingTasks` come from a deduped-by-agent view: a
 * group-shared agent surfaces every member's run, so the raw list would
 * double-count a single shared RUNNING conversation as "Running: N" across N
 * members.
 */
export interface DashboardKpis {
  runningTasks: number
  awaitingTasks: number
}

/**
 * Reduce a task list to one representative row per agent_id. The most
 * recently updated row wins (matches how the backend orders /tasks).
 *
 * Pure — no store, no Pinia, no DOM.
 *
 * Tie-break: when two rows for the same `agent_id` have equal `updated_at`
 * timestamps, the earlier-encountered row in iteration order wins
 * (strict-less-than comparison). Callers control the tie-break by sorting
 * first if they need a specific policy.
 *
 * @param pickFrom  Optional filter — only consider rows whose status is in
 *                  this set. Defaults to every status.
 */
export function latestTaskPerAgent(
  tasks: readonly Task[],
  pickFrom?: ReadonlySet<TaskStatus>,
): Map<number, Task> {
  const latest = new Map<number, Task>()
  for (const task of tasks) {
    if (pickFrom !== undefined && !pickFrom.has(task.status)) continue
    const current = latest.get(task.agent_id)
    if (current === undefined || current.updated_at < task.updated_at) {
      latest.set(task.agent_id, task)
    }
  }
  return latest
}

/**
 * Count "running" and "pending-approval" tasks after deduping by agent_id.
 * Without the dedup, a shared agent where 3 group members each have a RUNNING
 * task would count as 3 (one per member); with the dedup it's 1 — matches the
 * operator mental model of "one conversation per agent".
 */
export function kpiCountsFromTasks(tasks: readonly Task[]): DashboardKpis {
  const latest = latestTaskPerAgent(tasks)
  let running = 0
  let awaiting = 0
  for (const task of latest.values()) {
    if (task.status === 'RUNNING') running++
    else if (task.status === 'PENDING_APPROVAL') awaiting++
  }
  return { runningTasks: running, awaitingTasks: awaiting }
}

/**
 * Count "aborted" tasks after deduping by agent_id. Same dedupe rationale as
 * {@link kpiCountsFromTasks}: a shared agent with 3 aborted rows (one per group
 * member) should count as 1 aborted conversation, not 3.
 *
 * For admin views that intentionally want every member's interrupted chat to
 * appear, count the rows directly — that variant bypasses the dedupe.
 */
export function dedupedAbortedCount(tasks: readonly Task[]): number {
  const latest = latestTaskPerAgent(
    tasks,
    new Set<TaskStatus>(['ABORTED']),
  )
  return latest.size
}
