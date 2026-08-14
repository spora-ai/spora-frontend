import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '@/stores/tasks'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error { constructor(public m: string) { super(m) } },
}))

import { api } from '@/api/client'

const mockApi = api as ReturnType<typeof vi.fn>

const mockTask = {
  id: 1,
  agent_id: 1,
  status: 'RUNNING',
  user_prompt: 'Do something',
  final_response: null,
  step_count: 1,
  max_steps: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
}

const mockTaskDetail = {
  ...mockTask,
  tool_calls: [],
  history: [],
}

describe('useTaskStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApi.get.mockReset()
    setActivePinia(createPinia())
  })

  describe('fetchTasks', () => {
    it('fetches and sets tasks list', async () => {
      const tasks = [mockTask]
      mockApi.get.mockResolvedValueOnce({ tasks })

      const store = useTaskStore()
      await store.fetchTasks()

      expect(store.tasks).toEqual(tasks)
    })
  })

  describe('createTaskForAgent', () => {
    it('posts with agent_id and prompt', async () => {
      mockApi.post.mockResolvedValueOnce({ task: mockTask })

      const store = useTaskStore()
      const result = await store.createTaskForAgent(1, 'Do something')

      expect(mockApi.post).toHaveBeenCalledWith('/tasks', {
        agent_id: 1,
        prompt: 'Do something',
      })
      expect(result).toEqual(mockTask)
    })
  })

  describe('fetchTaskDetail', () => {
    it('replaces activeTask on first load', async () => {
      mockApi.get.mockResolvedValueOnce({ task: mockTaskDetail })

      const store = useTaskStore()
      await store.fetchTaskDetail(1)

      expect(store.activeTask).toEqual(mockTaskDetail)
    })

    it('merges incremental history entries (server filters by since_sequence)', async () => {
      const first: typeof mockTaskDetail = {
        ...mockTaskDetail,
        history: [{ sequence: 0, role: 'user' as const, content: 'Hi', tool_call_id: null, tool_name: null }],
      }
      // Second response: server returns only entries where sequence > 0 (the new one)
      const second: typeof mockTaskDetail = {
        ...mockTaskDetail,
        history: [
          { sequence: 1, role: 'assistant' as const, content: 'Hello', tool_call_id: null, tool_name: null },
        ],
      }

      mockApi.get
        .mockResolvedValueOnce({ task: first })
        .mockResolvedValueOnce({ task: second })

      const store = useTaskStore()
      await store.fetchTaskDetail(1)
      await store.fetchTaskDetail(1, 0)

      // Server filters by since_sequence so only new entries are appended
      expect(store.activeTask!.history.length).toBe(2)
      expect(store.activeTask!.history[0].sequence).toBe(0)
      expect(store.activeTask!.history[1].sequence).toBe(1)
    })

    it('nullifies activeTask.totals when appending a usage-bearing history entry', async () => {
      // Regression for Bug B: the server doesn't recompute the
      // `totals` aggregate on incremental polls, so the panel would
      // stay stuck at the first-fetch value. The store nullifies
      // `totals` after pushing new entries, forcing the panel to
      // re-derive from `history`.
      const firstTotals = {
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        provider: 'anthropic' as const,
      }
      const first: typeof mockTaskDetail = {
        ...mockTaskDetail,
        totals: firstTotals,
        history: [{ sequence: 0, role: 'user' as const, content: 'Hi', tool_call_id: null, tool_name: null }],
      }
      // Second response: a new assistant turn carrying a usage row.
      const newUsage = {
        input_tokens: 200,
        output_tokens: 80,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 100,
        provider: 'anthropic' as const,
      }
      const second: typeof mockTaskDetail = {
        ...mockTaskDetail,
        totals: firstTotals,
        history: [
          {
            sequence: 1,
            role: 'assistant' as const,
            content: 'Hello',
            tool_call_id: null,
            tool_name: null,
            usage: newUsage,
          },
        ],
      }

      mockApi.get
        .mockResolvedValueOnce({ task: first })
        .mockResolvedValueOnce({ task: second })

      const store = useTaskStore()
      await store.fetchTaskDetail(1)
      // Sanity: first fetch sets totals from the server.
      expect(store.activeTask!.totals).toEqual(firstTotals)

      await store.fetchTaskDetail(1, 0)
      // After the incremental fetch appends the new usage-bearing
      // entry, totals must be null so the panel re-derives.
      expect(store.activeTask!.totals).toBeNull()
      expect(store.activeTask!.history).toHaveLength(2)
    })
  })

  describe('approveTask', () => {
    it('posts approvals and refreshes detail', async () => {
      mockApi.post.mockResolvedValueOnce(undefined)
      mockApi.get.mockResolvedValueOnce({ task: { ...mockTaskDetail, status: 'RUNNING' } })

      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'PENDING_APPROVAL' }
      await store.approveTask(1, [{ providerCallId: '1', decision: 'approve', arguments: {} }])

      expect(mockApi.post).toHaveBeenCalledWith('/tasks/1/approve', {
        decisions: [{ provider_call_id: '1', decision: 'approve', arguments: {} }],
      })
    })
  })

  describe('rejectTask', () => {
    it('posts rejection reason and refreshes detail', async () => {
      mockApi.post.mockResolvedValueOnce(undefined)
      mockApi.get.mockResolvedValueOnce({ task: { ...mockTaskDetail, status: 'RUNNING' } })

      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'PENDING_APPROVAL' }
      await store.rejectTask(1, 'No thanks')

      expect(mockApi.post).toHaveBeenCalledWith('/tasks/1/reject', {
        reason: 'No thanks',
      })
    })
  })

  describe('pendingToolCalls', () => {
    it('returns only PENDING tool calls', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...mockTaskDetail,
        tool_calls: [
          { id: 1, tool_name: 'WebSearch', tool_type: 'search', status: 'PENDING_APPROVAL', proposed_arguments: {}, approved_arguments: null, human_description: null, result_content: null, executed_at: null },
          { id: 2, tool_name: 'Calculator', tool_type: 'calc', status: 'EXECUTED', proposed_arguments: {}, approved_arguments: {}, human_description: null, result_content: '42', executed_at: null },
        ],
      }

      expect(store.pendingToolCalls.length).toBe(1)
      expect(store.pendingToolCalls[0].id).toBe(1)
    })
  })

  describe('isTerminal', () => {
    it('returns true for COMPLETED', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'COMPLETED' }
      expect(store.isTerminal).toBe(true)
    })

    it('returns true for FAILED', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'FAILED' }
      expect(store.isTerminal).toBe(true)
    })

    it('returns false for RUNNING', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'RUNNING' }
      expect(store.isTerminal).toBe(false)
    })

    it('returns false when no activeTask', () => {
      const store = useTaskStore()
      expect(store.isTerminal).toBe(false)
    })
  })

  describe('clearActiveTask', () => {
    it('resets activeTask and lastSequence', () => {
      const store = useTaskStore()
      store.activeTask = mockTaskDetail
      store.clearActiveTask()
      expect(store.activeTask).toBe(null)
    })
  })

  describe('tasksByAgent', () => {
    it('groups tasks by agent_id', () => {
      const store = useTaskStore()
      store.tasks = [
        { ...mockTask, id: 1, agent_id: 1 },
        { ...mockTask, id: 2, agent_id: 2 },
        { ...mockTask, id: 3, agent_id: 1 },
      ]

      const grouped = store.tasksByAgent
      expect(grouped.get(1)?.length).toBe(2)
      expect(grouped.get(2)?.length).toBe(1)
    })
  })

  describe('retryTask', () => {
    it('calls POST /tasks/${taskId}/retry', async () => {
      mockApi.post.mockResolvedValueOnce({ task: { ...mockTask, id: 2 } })

      const store = useTaskStore()
      await store.retryTask(1)

      expect(mockApi.post).toHaveBeenCalledWith('/tasks/1/retry')
    })

    it('returns the new task from the API response', async () => {
      const newTask = { ...mockTask, id: 2, status: 'RUNNING' }
      mockApi.post.mockResolvedValueOnce({ task: newTask })

      const store = useTaskStore()
      const result = await store.retryTask(1)

      expect(result).toEqual(newTask)
    })
  })

  describe('applyTaskUpdate', () => {
    it('merges error_code and error_message from SSE data', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, status: 'RUNNING', error_code: null, error_message: null }

      store.applyTaskUpdate(1, {
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        error_message: 'API rate limit exceeded.',
      })

      expect(store.activeTask!.status).toBe('FAILED')
      expect(store.activeTask!.error_code).toBe('RATE_LIMIT')
      expect(store.activeTask!.error_message).toBe('API rate limit exceeded.')
    })

    it('does nothing when activeTask is null', () => {
      const store = useTaskStore()
      // Should not throw
      store.applyTaskUpdate(999, { error_code: 'SERVER_ERROR' })
      expect(store.activeTask).toBeNull()
    })

    it('does nothing when taskId does not match activeTask', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail }
      store.applyTaskUpdate(999, { error_code: 'SERVER_ERROR' })
      expect(store.activeTask!.error_code).toBeUndefined()
    })

    it('merges new history entries filtering by sequence', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...mockTaskDetail,
        history: [{ sequence: 0, role: 'user', content: 'Hello', tool_call_id: null, tool_name: null }],
      }

      // SSE sends a new entry with sequence 1
      store.applyTaskUpdate(1, {
        history: [
          { sequence: 1, role: 'assistant', content: 'Hi there', tool_call_id: null, tool_name: null },
        ],
      })

      expect(store.activeTask!.history).toHaveLength(2)
      expect(store.activeTask!.history[1].sequence).toBe(1)
    })

    it('does not duplicate history entries on duplicate sequence', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...mockTaskDetail,
        history: [{ sequence: 0, role: 'user', content: 'Hello', tool_call_id: null, tool_name: null }],
      }

      // Same sequence delivered twice via SSE
      store.applyTaskUpdate(1, {
        history: [{ sequence: 1, role: 'assistant', content: 'First', tool_call_id: null, tool_name: null }],
      })
      store.applyTaskUpdate(1, {
        history: [{ sequence: 1, role: 'assistant', content: 'Duplicate', tool_call_id: null, tool_name: null }],
      })

      expect(store.activeTask!.history).toHaveLength(2)
    })

    it('replaces tool_calls entirely from SSE data', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...mockTaskDetail,
        tool_calls: [
          { id: 1, tool_name: 'WebSearch', tool_type: 'search', operation: null, operation_description: null, status: 'PENDING_APPROVAL', proposed_arguments: {}, approved_arguments: null, human_description: null, result_content: null, executed_at: null },
        ],
      }

      const newCalls = [
        { id: 1, tool_name: 'WebSearch', tool_type: 'search', operation: null, operation_description: null, status: 'EXECUTED', proposed_arguments: {}, approved_arguments: {}, human_description: null, result_content: 'Result', executed_at: '2026-01-01T00:00:02Z' },
      ]

      store.applyTaskUpdate(1, { tool_calls: newCalls })

      expect(store.activeTask!.tool_calls).toEqual(newCalls)
    })

    it('updates retry fields from SSE data', () => {
      const store = useTaskStore()
      store.activeTask = { ...mockTaskDetail, retry_of_task_id: null, retry_count: undefined, retry_after: null }

      store.applyTaskUpdate(1, {
        retry_of_task_id: 5,
        retry_count: 2,
        retry_after: '2026-01-01T00:05:00Z',
      })

      expect(store.activeTask!.retry_of_task_id).toBe(5)
      expect(store.activeTask!.retry_count).toBe(2)
      expect(store.activeTask!.retry_after).toBe('2026-01-01T00:05:00Z')
    })

    it('handles lightweight SSE data without tool_calls or history keys (taskListResource shape)', () => {
      // Data from taskListResource / publishIntermediateState has no tool_calls/history
      const store = useTaskStore()
      store.activeTask = {
        ...mockTaskDetail,
        status: 'RUNNING',
        step_count: 1,
        tool_calls: [{ id: 1, tool_name: 'WebSearch', tool_type: 'search', operation: null, operation_description: null, status: 'PENDING_APPROVAL', proposed_arguments: {}, approved_arguments: null, human_description: null, result_content: null, executed_at: null }],
        history: [{ sequence: 0, role: 'user', content: 'Hello', tool_call_id: null, tool_name: null }],
      }

      // Lightweight SSE update (no tool_calls/history keys)
      store.applyTaskUpdate(1, {
        id: 1,
        status: 'COMPLETED',
        step_count: 3,
        final_response: 'Done',
      })

      // Scalar fields updated
      expect(store.activeTask!.status).toBe('COMPLETED')
      expect(store.activeTask!.step_count).toBe(3)
      expect(store.activeTask!.final_response).toBe('Done')
      // tool_calls and history preserved (not overwritten since keys are absent)
      expect(store.activeTask!.tool_calls).toHaveLength(1)
      expect(store.activeTask!.history).toHaveLength(1)
    })
  })

  describe('lastTaskByAgent', () => {
    it('returns most recent task per agent', () => {
      const store = useTaskStore()
      store.tasks = [
        { ...mockTask, id: 1, agent_id: 1, updated_at: '2026-01-01T00:00:00Z' },
        { ...mockTask, id: 2, agent_id: 1, updated_at: '2026-01-02T00:00:00Z' },
        { ...mockTask, id: 3, agent_id: 2, updated_at: '2026-01-01T00:00:00Z' },
      ]

      const last = store.lastTaskByAgent
      expect(last.get(1)?.id).toBe(2) // newer
      expect(last.get(2)?.id).toBe(3)
    })
  })

  describe('applySseEventToTasks', () => {
    it('updates existing task in tasks array', () => {
      const store = useTaskStore()
      store.tasks = [{ ...mockTask }]

      store.applySseEventToTasks({
        id: 1,
        status: 'COMPLETED',
        step_count: 5,
        final_response: 'Done',
        updated_at: '2026-01-01T00:00:10Z',
      })

      expect(store.tasks[0].status).toBe('COMPLETED')
      expect(store.tasks[0].step_count).toBe(5)
      expect(store.tasks[0].final_response).toBe('Done')
    })

    it('prepends new task when not found in tasks array', () => {
      const store = useTaskStore()
      store.tasks = [{ ...mockTask, id: 1 }]

      store.applySseEventToTasks({
        id: 2,
        agent_id: 2,
        status: 'RUNNING',
        user_prompt: 'New task',
        step_count: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
      })

      expect(store.tasks.length).toBe(2)
      expect(store.tasks[0].id).toBe(2)
      expect(store.tasks[0].status).toBe('RUNNING')
    })

    it('ignores event with no taskId and no status', () => {
      const store = useTaskStore()
      store.tasks = [{ ...mockTask }]

      store.applySseEventToTasks({ step_count: 5 })

      expect(store.tasks.length).toBe(1)
      expect(store.tasks[0].step_count).toBe(1)
    })
  })

  describe('startDashboardPolling', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('initial call fetches without since query param', async () => {
      mockApi.get.mockResolvedValueOnce({
        tasks: [],
        server_time: '2026-01-01T00:01:00Z',
      })

      const store = useTaskStore()
      store.startDashboardPolling()

      // Allow the initial setTimeout to fire and pending promises to resolve
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockApi.get).toHaveBeenCalledWith('/tasks')
    })

    it('subsequent calls use server_time as since param', async () => {
      mockApi.get.mockResolvedValue({
        tasks: [],
        server_time: '2026-01-01T00:01:00Z',
      })

      const store = useTaskStore()
      store.startDashboardPolling()
      await vi.advanceTimersByTimeAsync(30_000)

      store.startDashboardPolling()
      await vi.advanceTimersByTimeAsync(30_000)

      // First call: no since param (initial fetch)
      // Second call: since=lastDashboardPollAt (set from first response)
      expect(mockApi.get).toHaveBeenNthCalledWith(1, '/tasks')
      expect(mockApi.get).toHaveBeenNthCalledWith(2, '/tasks?since=2026-01-01T00%3A01%3A00Z')
    })

    it('stops previous polling when called again', async () => {
      mockApi.get.mockResolvedValue({
        tasks: [],
        server_time: '2026-01-01T00:01:00Z',
      })

      const store = useTaskStore()
      store.startDashboardPolling()
      await vi.advanceTimersByTimeAsync(30_000)

      store.startDashboardPolling()
      await vi.advanceTimersByTimeAsync(30_000)

      // Only one fetch should have occurred from the second polling session
      expect(mockApi.get).toHaveBeenCalledTimes(2)
    })
  })
})

describe('additional tasks store coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('cancelRetryChain calls DELETE /tasks/{id}/retry-chain', async () => {
    mockApi.delete.mockResolvedValueOnce(undefined)
    const { useTaskStore } = await import('@/stores/tasks')
    const store = useTaskStore()
    await store.cancelRetryChain(99)
    expect(mockApi.delete).toHaveBeenCalledWith('/tasks/99/retry-chain')
  })
})

describe('sub-task cache (sub_agent op)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApi.get.mockReset()
    setActivePinia(createPinia())
  })

  const childTask = {
    id: 200,
    agent_id: 7,
    status: 'RUNNING',
    user_prompt: 'do thing',
    final_response: null,
    step_count: 0,
    max_steps: 5,
    parent_task_id: 1,
    tool_calls: [],
    history: [],
    totals: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:01Z',
  }

  it('fetchSubTaskDetail fetches and caches the child task', async () => {
    mockApi.get.mockResolvedValueOnce({ task: childTask })
    const store = useTaskStore()
    await store.fetchSubTaskDetail(200)
    expect(mockApi.get).toHaveBeenCalledWith('/tasks/200')
    expect(store.subTaskCache.size).toBe(1)
    expect(store.subTaskCache.get(200)?.status).toBe('RUNNING')
  })

  it('fetchSubTaskDetail is a no-op when the id is already cached', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(200, childTask)
    await store.fetchSubTaskDetail(200)
    expect(mockApi.get).not.toHaveBeenCalled()
  })

  it('clearSubTaskCache empties the cache', async () => {
    mockApi.get.mockResolvedValueOnce({ task: childTask })
    const store = useTaskStore()
    await store.fetchSubTaskDetail(200)
    expect(store.subTaskCache.size).toBe(1)
    store.clearSubTaskCache()
    expect(store.subTaskCache.size).toBe(0)
  })

  it('applyTaskUpdate patches a cached sub-task entry on a status change', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(200, childTask)
    // Active task is something else so the SSE event falls through
    // to the sub-task cache path.
    store.activeTask = {
      id: 1,
      agent_id: 1,
      status: 'RUNNING',
      user_prompt: 'parent',
      final_response: null,
      step_count: 0,
      max_steps: 10,
      tool_calls: [],
      history: [],
      totals: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    }
    store.applyTaskUpdate(200, { status: 'PENDING_APPROVAL' })
    expect(store.subTaskCache.get(200)?.status).toBe('PENDING_APPROVAL')
  })

  it('applyTaskUpdate patches a cached sub-task data field', () => {
    const store = useTaskStore()
    store.subTaskCache.set(200, { ...childTask, status: 'RUNNING' })
    store.activeTask = { ...mockTaskDetail }

    store.applyTaskUpdate(200, { data: { spawned_sub_task_ids: [99] } })

    expect(store.subTaskCache.get(200)?.data).toEqual({ spawned_sub_task_ids: [99] })
  })

  it('applyTaskUpdate does not patch a terminal cached sub-task', () => {
    const store = useTaskStore()
    store.subTaskCache.set(200, { ...childTask, status: 'COMPLETED', data: null })
    store.activeTask = { ...mockTaskDetail }

    store.applyTaskUpdate(200, {
      status: 'RUNNING',
      data: { spawned_sub_task_ids: [99] },
    })

    expect(store.subTaskCache.get(200)?.status).toBe('COMPLETED')
    expect(store.subTaskCache.get(200)?.data).toBeNull()
  })

  it('applyTaskUpdate is a no-op for unknown task ids', async () => {
    const store = useTaskStore()
    store.activeTask = {
      id: 1,
      agent_id: 1,
      status: 'RUNNING',
      user_prompt: 'parent',
      final_response: null,
      step_count: 0,
      max_steps: 10,
      tool_calls: [],
      history: [],
      totals: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    }
    store.applyTaskUpdate(999, { status: 'COMPLETED' })
    expect(store.subTaskCache.size).toBe(0)
  })
})

describe('abortTask', () => {
  it('POSTs to /tasks/{id}/abort and patches the cached tasks list', async () => {
    const aborted = { ...mockTask, id: 7, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:00:00+00:00' }
    mockApi.post.mockResolvedValueOnce({ task: aborted })

    const store = useTaskStore()
    store.tasks = [
      { ...mockTask, id: 7, status: 'RUNNING' as const },
      { ...mockTask, id: 8, status: 'COMPLETED' as const },
    ]

    const result = await store.abortTask(7)

    expect(mockApi.post).toHaveBeenCalledWith('/tasks/7/abort', {})
    expect(result.status).toBe('ABORTED')
    // Id 7 was patched in place; id 8 untouched.
    expect(store.tasks.find((t) => t.id === 7)?.status).toBe('ABORTED')
    expect(store.tasks.find((t) => t.id === 8)?.status).toBe('COMPLETED')
  })

  it('returns the aborted task even when not in the cached list', async () => {
    const aborted = { ...mockTask, id: 99, status: 'ABORTED' as const }
    mockApi.post.mockResolvedValueOnce({ task: aborted })

    const store = useTaskStore()
    store.tasks = []

    const result = await store.abortTask(99)

    expect(result.status).toBe('ABORTED')
    // The tasks list is empty because the patch loop's findIndex returns -1.
    expect(store.tasks).toEqual([])
  })

  it('optimistically flips activeTask to ABORTED BEFORE the API call resolves', async () => {
    // The chat should stop showing bouncing dots the moment the user
    // clicks Abort — no waiting on the network round-trip. A pending
    // promise that resolves later confirms the optimistic flip happened
    // before await, so the user always gets visible feedback.
    let resolvePost: ((v: unknown) => void) | null = null
    mockApi.post.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = resolve
      }),
    )

    const store = useTaskStore()
    store.activeTask = { ...mockTaskDetail, id: 27, status: 'RUNNING' }

    const inFlight = store.abortTask(27)
    // Synchronously observed: chat has already flipped to ABORTED.
    expect(store.activeTask?.status).toBe('ABORTED')
    expect(store.activeTask?.aborted_at).not.toBeNull()

    // Now resolve the API call.
    const serverTask = {
      ...mockTask,
      id: 27,
      status: 'ABORTED' as const,
      aborted_at: '2026-08-13T12:34:56+00:00',
    }
    resolvePost!({ task: serverTask })
    await inFlight

    // Server-confirmed timestamp replaces the optimistic placeholder.
    expect(store.activeTask?.aborted_at).toBe('2026-08-13T12:34:56+00:00')
  })

  it('rolls the optimistic flip back when the API call rejects', async () => {
    // A failed abort must not leave the chat stuck on ABORTED for a
    // task that is actually still running. We snap the status back to
    // whatever was there before the optimistic update.
    mockApi.post.mockRejectedValueOnce(new Error('network down'))

    const store = useTaskStore()
    store.activeTask = {
      ...mockTaskDetail,
      id: 27,
      status: 'RUNNING',
      aborted_at: null,
    }

    await expect(store.abortTask(27)).rejects.toThrow('network down')
    expect(store.activeTask?.status).toBe('RUNNING')
    expect(store.activeTask?.aborted_at).toBeNull()
  })

  it('does not touch activeTask when aborting a different task id', async () => {
    // Aborting a sub-agent whose chat isn't open must not pollute the
    // currently active chat — only the dashboard cache and the response
    // should change.
    const aborted = { ...mockTask, id: 99, status: 'ABORTED' as const }
    mockApi.post.mockResolvedValueOnce({ task: aborted })

    const store = useTaskStore()
    store.activeTask = { ...mockTaskDetail, id: 27, status: 'RUNNING' }
    store.tasks = [{ ...mockTask, id: 99, status: 'RUNNING' as const }]

    await store.abortTask(99)

    // The activeTask is unrelated to the abort — leave it untouched.
    expect(store.activeTask?.status).toBe('RUNNING')
    // The dashboard cache for the abort target is patched.
    expect(store.tasks.find((t) => t.id === 99)?.status).toBe('ABORTED')
  })
})

describe('abortedCount', () => {
  it('counts only ABORTED tasks regardless of other activity', () => {
    const store = useTaskStore()
    store.tasks = [
      { ...mockTask, id: 1, status: 'RUNNING' as const },
      { ...mockTask, id: 2, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:00:00+00:00' },
      { ...mockTask, id: 3, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:01:00+00:00' },
      { ...mockTask, id: 4, status: 'COMPLETED' as const },
      { ...mockTask, id: 5, status: 'PENDING_APPROVAL' as const },
    ]
    expect(store.abortedCount).toBe(2)
  })

  it('returns 0 when no tasks are ABORTED', () => {
    const store = useTaskStore()
    store.tasks = []
    expect(store.abortedCount).toBe(0)
  })
})

describe('activeStatesByAgent (ABORTED includes the new state)', () => {
  it('counts ABORTED as active for the dashboard pills', () => {
    const store = useTaskStore()
    store.tasks = [
      { ...mockTask, id: 1, agent_id: 10, status: 'ABORTED' as const },
    ]
    expect(store.activeStatesByAgent.get(10)?.has('ABORTED')).toBe(true)
  })
})

describe('detail poller quiescent skip (ABORTED)', () => {
  it('does not start detail polling for a task that is already ABORTED', async () => {
    vi.useFakeTimers()
    const store = useTaskStore()
    const abortedTaskDetail = {
      ...mockTaskDetail,
      status: 'ABORTED' as const,
      aborted_at: '2026-08-08T12:00:00+00:00',
    }
    mockApi.get.mockResolvedValue({ task: abortedTaskDetail })

    store.activeTask = abortedTaskDetail
    store.startDetailPolling(1)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(mockApi.get).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
