import { describe, expect, it } from 'vitest'
import {
  latestTaskPerAgent,
  kpiCountsFromTasks,
  dedupedAbortedCount,
} from '@/utils/dashboardKpis'
import type { Task, TaskStatus } from '@/types/task'

/**
 * Build a minimal Task with the fields the dashboardKpis helpers read.
 * Anything else (tool_calls, history, etc.) is irrelevant to the
 * KPI derivation — the helpers only touch agent_id + status +
 * updated_at.
 */
function makeTask(overrides: {
  id: number
  agent_id: number
  status: TaskStatus
  updated_at: string
}): Task {
  return {
    id: overrides.id,
    agent_id: overrides.agent_id,
    status: overrides.status,
    updated_at: overrides.updated_at,
    user_prompt: '',
    final_response: null,
    step_count: 0,
    max_steps: 10,
    created_at: overrides.updated_at,
    parent_task_id: undefined,
    error_code: null,
    error_message: null,
    failure_reason: null,
    retry_of_task_id: null,
    retry_count: 0,
    retry_after: null,
    max_retries: 0,
    retry_after_minutes: 0,
    aborted_at: null,
  }
}

describe('latestTaskPerAgent', () => {
  it('returnsits(one row per agent_id, picking the most recent)', () => {
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 10, status: 'ABORTED', updated_at: '2026-08-31T11:00:00Z' }),
      makeTask({ id: 3, agent_id: 20, status: 'COMPLETED', updated_at: '2026-08-31T12:00:00Z' }),
    ]
    const latest = latestTaskPerAgent(tasks)
    expect(latest.size).toBe(2)
    expect(latest.get(10)?.id).toBe(2)
    expect(latest.get(20)?.id).toBe(3)
  })

  it('filters by status when pickFrom is given', () => {
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 10, status: 'ABORTED', updated_at: '2026-08-31T11:00:00Z' }),
      makeTask({ id: 3, agent_id: 20, status: 'ABORTED', updated_at: '2026-08-31T12:00:00Z' }),
    ]
    const latest = latestTaskPerAgent(tasks, new Set<TaskStatus>(['ABORTED']))
    expect(latest.size).toBe(2)
    expect(latest.get(10)?.id).toBe(2)
    expect(latest.get(20)?.id).toBe(3)
  })

  it('returns empty map for empty input', () => {
    expect(latestTaskPerAgent([]).size).toBe(0)
  })
})

describe('kpiCountsFromTasks', () => {
  it('counts RUNNING + PENDING_APPROVAL after deduping by agent_id', () => {
    // Group-shared scenario: 3 members each have a RUNNING task on agent 10,
    // and 2 members have a PENDING_APPROVAL task on agent 20.
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:01:00Z' }),
      makeTask({ id: 3, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:02:00Z' }),
      makeTask({ id: 4, agent_id: 20, status: 'PENDING_APPROVAL', updated_at: '2026-08-31T11:00:00Z' }),
      makeTask({ id: 5, agent_id: 20, status: 'PENDING_APPROVAL', updated_at: '2026-08-31T11:01:00Z' }),
      makeTask({ id: 6, agent_id: 30, status: 'COMPLETED', updated_at: '2026-08-31T12:00:00Z' }),
    ]
    const kpis = kpiCountsFromTasks(tasks)
    expect(kpis).toEqual({ runningTasks: 1, awaitingTasks: 1 })
  })

  it('uses the latest row per agent so a transitioning task flips the KPI', () => {
    // Agent 10's most-recent task is RUNNING; the older row is COMPLETED.
    // Without dedupe, the raw count would include COMPLETED and RUNNING,
    // but the dedup should report RUNNING (one agent, one running).
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'COMPLETED', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T11:00:00Z' }),
    ]
    const kpis = kpiCountsFromTasks(tasks)
    expect(kpis).toEqual({ runningTasks: 1, awaitingTasks: 0 })
  })

  it('returns zero counts for an empty task list', () => {
    expect(kpiCountsFromTasks([])).toEqual({ runningTasks: 0, awaitingTasks: 0 })
  })
})

describe('dedupedAbortedCount', () => {
  it('counts distinct agents with an aborted row (group-shared dedupe)', () => {
    // 3 members each aborted on agent 10; only agent 20 has 1 abort.
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'ABORTED', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 10, status: 'ABORTED', updated_at: '2026-08-31T10:01:00Z' }),
      makeTask({ id: 3, agent_id: 10, status: 'ABORTED', updated_at: '2026-08-31T10:02:00Z' }),
      makeTask({ id: 4, agent_id: 20, status: 'ABORTED', updated_at: '2026-08-31T11:00:00Z' }),
    ]
    expect(dedupedAbortedCount(tasks)).toBe(2)
  })

  it('returns 0 when no rows are aborted (status filter is honored)', () => {
    const tasks = [
      makeTask({ id: 1, agent_id: 10, status: 'RUNNING', updated_at: '2026-08-31T10:00:00Z' }),
      makeTask({ id: 2, agent_id: 20, status: 'COMPLETED', updated_at: '2026-08-31T11:00:00Z' }),
    ]
    expect(dedupedAbortedCount(tasks)).toBe(0)
  })
})