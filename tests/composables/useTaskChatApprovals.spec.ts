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

import { useTaskChatApprovals } from '@/composables/useTaskChatApprovals'

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
