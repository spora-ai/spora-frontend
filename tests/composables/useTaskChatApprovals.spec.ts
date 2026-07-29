/**
 * useTaskChatApprovals — submit + bulk-reject handlers.
 *
 * Mocks the task store + toast so the composable can run in isolation.
 * Covers the success and error branches of the two handlers, the toast
 * summary on partial submissions, the single "submitting" flag, and
 * the callback that re-scrolls on the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const toastMock = { error: vi.fn(), success: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

const pendingToolCallsRef = ref<Array<{ id: number; provider_call_id: string; tool_name: string }>>([])
const taskStoreMock = {
  get pendingToolCalls() { return pendingToolCallsRef.value },
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
  startDetailPolling: vi.fn(),
}
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
}))

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { useTaskChatApprovals, summarizeApprovals } from '@/composables/useTaskChatApprovals'

const taskId = ref(1)
const onAfterMutation = vi.fn()

beforeEach(() => {
  pendingToolCallsRef.value = []
  toastMock.error.mockClear()
  toastMock.success.mockClear()
  taskStoreMock.approveTask.mockReset()
  taskStoreMock.approveTask.mockResolvedValue(undefined)
  taskStoreMock.rejectTask.mockReset()
  taskStoreMock.rejectTask.mockResolvedValue(undefined)
  taskStoreMock.startDetailPolling.mockReset()
  onAfterMutation.mockReset()
})

describe('useTaskChatApprovals', () => {
  describe('onSubmitDecisions', () => {
    it('maps payload fields and calls store.approveTask once with all approvals', async () => {
      pendingToolCallsRef.value = [
        { id: 1, provider_call_id: 'pc-1', tool_name: 'web_search' },
        { id: 2, provider_call_id: 'pc-2', tool_name: 'send_email' },
      ]
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({
        approvals: [
          { providerCallId: 'pc-1', arguments: { x: 1 } },
          { providerCallId: 'pc-2', arguments: { y: 2 } },
        ],
      })
      expect(taskStoreMock.approveTask).toHaveBeenCalledWith(1, [
        { provider_call_id: 'pc-1', arguments: { x: 1 } },
        { provider_call_id: 'pc-2', arguments: { y: 2 } },
      ])
      expect(toastMock.success).toHaveBeenCalledWith('Approved 2 tools.')
      expect(taskStoreMock.startDetailPolling).toHaveBeenCalledWith(1)
      expect(onAfterMutation).toHaveBeenCalled()
      expect(c.submitting.value).toBe(false)
    })

    it('summarises the single-tool case as "Approved: <name>."', async () => {
      pendingToolCallsRef.value = [
        { id: 1, provider_call_id: 'pc-1', tool_name: 'web_search' },
      ]
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({
        approvals: [{ providerCallId: 'pc-1', arguments: { x: 1 } }],
      })
      expect(toastMock.success).toHaveBeenCalledWith('Approved: web_search.')
    })

    it('falls back to "Approved 1 tool." when the single approval has no resolvable tool_name', async () => {
      // empty pendingToolCallsRef means resolveName returns undefined —
      // the summary must still report one approved tool (not "No tools submitted.").
      pendingToolCallsRef.value = []
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({
        approvals: [{ providerCallId: 'pc-unknown', arguments: { x: 1 } }],
      })
      expect(toastMock.success).toHaveBeenCalledWith('Approved 1 tool.')
    })

    it('reports "No tools submitted." only when the approval payload is empty', async () => {
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({ approvals: [] })
      expect(toastMock.success).toHaveBeenCalledWith('No tools submitted.')
    })

    it('surfaces the error and stores it in approveError', async () => {
      taskStoreMock.approveTask.mockRejectedValueOnce(new Error('nope'))
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({ approvals: [] })
      expect(toastMock.error).toHaveBeenCalledWith('nope')
      expect(c.approveError.value).toBe('nope')
      expect(c.submitting.value).toBe(false)
    })

    it('falls back to a generic message when the rejection is not an Error', async () => {
      taskStoreMock.approveTask.mockRejectedValueOnce('plain string error')
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onSubmitDecisions({ approvals: [] })
      expect(toastMock.error).toHaveBeenCalledWith('Approval failed.')
      expect(c.approveError.value).toBe('Approval failed.')
    })

    it('clears approveError at the start of the call', async () => {
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      c.approveError.value = 'old error'
      await c.onSubmitDecisions({ approvals: [] })
      expect(c.approveError.value).toBeNull()
    })

    it('marks submitting true synchronously, then false after the call resolves', async () => {
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      const promise = c.onSubmitDecisions({ approvals: [] })
      expect(c.submitting.value).toBe(true)
      await promise
      expect(c.submitting.value).toBe(false)
    })
  })

  describe('onRejectAll', () => {
    it('calls store.rejectTask with the reason and triggers a toast', async () => {
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onRejectAll({ reason: 'too risky' })
      expect(taskStoreMock.rejectTask).toHaveBeenCalledWith(1, 'too risky')
      expect(toastMock.success).toHaveBeenCalledWith('All tools rejected.')
      expect(taskStoreMock.startDetailPolling).toHaveBeenCalledWith(1)
      expect(onAfterMutation).toHaveBeenCalled()
      expect(c.rejecting.value).toBe(false)
    })

    it('surfaces the error and resets state', async () => {
      const { ApiError } = await import('@/api/client')
      taskStoreMock.rejectTask.mockRejectedValueOnce(new ApiError('bad'))
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onRejectAll({ reason: 'x' })
      expect(toastMock.error).toHaveBeenCalledWith('bad')
      expect(c.approveError.value).toBe('bad')
      expect(c.rejecting.value).toBe(false)
    })

    it('falls back to a generic message when onRejectAll fails with a non-ApiError', async () => {
      taskStoreMock.rejectTask.mockRejectedValueOnce('plain string error')
      const c = useTaskChatApprovals(taskId, onAfterMutation)
      await c.onRejectAll({ reason: 'x' })
      expect(toastMock.error).toHaveBeenCalledWith('Rejection failed.')
      expect(c.approveError.value).toBe('Rejection failed.')
    })
  })
})

describe('summarizeApprovals', () => {
  const resolve = (id: string): string | undefined =>
    id === 'pc-1' ? 'web_search' : id === 'pc-2' ? 'send_email' : undefined

  it('returns "No tools submitted." for an empty approval list', () => {
    expect(summarizeApprovals([], resolve)).toBe('No tools submitted.')
  })

  it('returns "Approved: <name>." for a single named approval', () => {
    expect(summarizeApprovals([{ providerCallId: 'pc-1' }], resolve))
      .toBe('Approved: web_search.')
  })

  it('falls back to "Approved 1 tool." for a single unnamed approval', () => {
    expect(summarizeApprovals([{ providerCallId: 'pc-unknown' }], resolve))
      .toBe('Approved 1 tool.')
  })

  it('returns "Approved <n> tools." for a multi-tool batch regardless of resolved names', () => {
    expect(summarizeApprovals(
      [{ providerCallId: 'pc-1' }, { providerCallId: 'pc-2' }],
      resolve,
    )).toBe('Approved 2 tools.')

    // Mixed named/unnamed — count wins, not the resolved-name count.
    expect(summarizeApprovals(
      [{ providerCallId: 'pc-1' }, { providerCallId: 'pc-unknown' }],
      resolve,
    )).toBe('Approved 2 tools.')
  })
})
