/**
 * useTaskChatRetry — derived banner state + retry/cancel handlers.
 *
 * Mocks Pinia stores (active task + current agent) so we can exercise the
 * composable in isolation, including the success and error branches of the
 * action handlers. Retries are now in-place (same task_id, same URL) so the
 * composable must NOT navigate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const toastMock = { error: vi.fn(), success: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

const activeTaskRef = ref<Record<string, unknown> | null>(null)
const taskStoreMock = {
  get activeTask() { return activeTaskRef.value },
  get isTerminal(): boolean {
    const t = activeTaskRef.value as { status?: string } | null
    return t?.status === 'COMPLETED' || t?.status === 'FAILED'
  },
  cancelRetryChain: vi.fn(),
  fetchTask: vi.fn(),
  fetchTaskDetail: vi.fn(),
  retryTask: vi.fn(),
  startDetailPolling: vi.fn(),
  stopDetailPolling: vi.fn(),
}
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
}))

const currentAgentRef = ref<{ allow_followup?: boolean } | null>(null)
const agentStoreMock = {
  get currentAgent() { return currentAgentRef.value },
}
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => agentStoreMock,
}))

// Stub the ApiError class so the composable's `instanceof ApiError` check works.
vi.mock('@/api/client', () => ({
  ApiError: class FakeApiError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { useTaskChatRetry } from '@/composables/useTaskChatRetry'
import { ApiError as FakeApiError } from '@/api/client'

function setActiveTask(overrides: Record<string, unknown> = {}): void {
  activeTaskRef.value = {
    id: 1,
    status: 'FAILED',
    step_count: 5,
    max_steps: 10,
    failure_reason: null,
    error_code: null,
    error_message: null,
    retry_of_task_id: null,
    max_retries: 0,
    retry_count: 0,
    retry_after: null,
    ...overrides,
  }
}

function setAgent(allowContinuation: boolean | undefined = true): void {
  currentAgentRef.value = { allow_followup: allowContinuation }
}

beforeEach(() => {
  setActivePinia(createPinia())
  activeTaskRef.value = null
  currentAgentRef.value = null
  // Clear call history but keep implementations.
  toastMock.error.mockClear()
  toastMock.success.mockClear()
  taskStoreMock.cancelRetryChain.mockClear()
  taskStoreMock.cancelRetryChain.mockResolvedValue(undefined)
  taskStoreMock.fetchTask.mockClear()
  taskStoreMock.fetchTask.mockResolvedValue(undefined)
  taskStoreMock.fetchTaskDetail.mockClear()
  taskStoreMock.fetchTaskDetail.mockResolvedValue(false)
  taskStoreMock.retryTask.mockClear()
  taskStoreMock.retryTask.mockResolvedValue({ id: 99 })
  taskStoreMock.startDetailPolling.mockClear()
  taskStoreMock.stopDetailPolling.mockClear()
})

describe('useTaskChatRetry', () => {
  describe('banner visibility', () => {
    it('hides every banner when there is no active task', () => {
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.showNonRetryableErrorBanner.value).toBe(false)
      expect(c.showCountdown.value).toBe(false)
    })

    it('shows retry banner for RATE_LIMIT when no retry_after is set', () => {
      setAgent(true)
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      expect(c.showNonRetryableErrorBanner.value).toBe(false)
    })

    it('shows retry banner when retry_after is set but auto-retry is disabled (max_retries=0)', () => {
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        max_retries: 0,
        retry_count: 0,
      })
      const c = useTaskChatRetry()
      expect(c.autoRetryDisabled.value).toBe(true)
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('hides retry banner when retry_after is set, auto-retry configured, and retries not exhausted', () => {
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        max_retries: 3,
        retry_count: 0,
        retry_of_task_id: null,
      })
      const c = useTaskChatRetry()
      expect(c.autoRetryConfigured.value).toBe(true)
      expect(c.canAutoRetry.value).toBe(true)
      expect(c.showRetryBanner.value).toBe(false)
    })

    it('hides retry banner for a retry task (retry_of_task_id set) even when retry_after is set', () => {
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        retry_of_task_id: 42,
        max_retries: 3,
        retry_count: 0,
      })
      const c = useTaskChatRetry()
      expect(c.autoRetryConfigured.value).toBe(false)
      expect(c.showRetryBanner.value).toBe(false)
    })

    it('shows the retry banner for a task whose worker vanished', () => {
      // The core writes WORKER_DISCONNECTED when it reaps a task whose
      // worker stopped. The code was in neither list, so the operator saw
      // no banner at all for a task the platform had just given up on.
      setAgent(true)
      setActiveTask({ status: 'FAILED', error_code: 'WORKER_DISCONNECTED' })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      expect(c.showNonRetryableErrorBanner.value).toBe(false)
    })

    it('shows the manual retry banner when a retry budget is configured but nothing is scheduled', () => {
      // The core arms a retry only while the budget lasts, so a task whose
      // budget is spent comes back with no retry time. The banner is then
      // the only way to retry it — the countdown has nothing to count.
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'WORKER_DISCONNECTED',
        retry_after: null,
        max_retries: 3,
        retry_count: 0,
      })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      expect(c.showCountdown.value).toBe(false)
    })

    it('shows the manual retry banner when the payload omits the retry key', () => {
      // An absent key is not a scheduled retry: nothing is armed, so the
      // banner is the only way back.
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'WORKER_DISCONNECTED',
        retry_after: undefined,
        max_retries: 3,
      })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      expect(c.showCountdown.value).toBe(false)
    })

    it('shows the manual retry banner at the end of a retry chain', () => {
      // The chain ends when the core clears `retry_of_task_id`: the row is
      // no longer a chain row, so the payload carries `max_retries` again
      // and the frontend believes a retry is configured. The budget is
      // spent, so nothing is armed and no retry time arrives.
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        retry_after: null,
        retry_of_task_id: null,
        retry_count: 3,
        max_retries: 3,
      })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      expect(c.showCountdown.value).toBe(false)
    })

    it('keeps the retry banner away from a code no retry can fix', () => {
      // A terminal code is the other banner's job — the manual retry
      // banner is for the codes a retry could still have helped.
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'NO_LLM_CONFIGURATION',
        retry_after: null,
        max_retries: 3,
      })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.showNonRetryableErrorBanner.value).toBe(true)
    })

    it('hides retry banner for non-retryable codes (NO_LLM_CONFIGURATION, UNKNOWN)', () => {
      setAgent(true)
      setActiveTask({ status: 'FAILED', error_code: 'NO_LLM_CONFIGURATION' })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.showNonRetryableErrorBanner.value).toBe(true)
    })

    it.each([
      ['USAGE_LIMIT_REACHED', 'The usage limit was reached, so the run stopped.'],
      ['CONTEXT_WINDOW_FIRST_TURN', 'Context window too small for the current prompt.'],
      ['REJECT_FAILED', 'Task reject failed: the agent state is missing.'],
      ['RESUME_FAILED', 'Task resume failed: the agent state is missing.'],
    ])('shows the terminal-error banner for %s', (code, message) => {
      // The core writes these codes for failures no retry can fix. They
      // were in neither list, so the operator saw no banner at all.
      setAgent(true)
      setActiveTask({ status: 'FAILED', error_code: code, error_message: message })
      const c = useTaskChatRetry()
      expect(c.showNonRetryableErrorBanner.value).toBe(true)
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.nonRetryableErrorMessage.value).toBe(message)
    })

    it('shows the terminal-error banner for a request the provider refused', () => {
      // BAD_REQUEST is the code the core answers a 400 from the provider
      // with. It was in neither list, so the failure was silent.
      setAgent(true)
      setActiveTask({
        status: 'FAILED',
        error_code: 'BAD_REQUEST',
        error_message: 'Invalid request. Please check your agent configuration.',
      })
      const c = useTaskChatRetry()
      expect(c.showNonRetryableErrorBanner.value).toBe(true)
      expect(c.showRetryBanner.value).toBe(false)
    })

    it('respects errorBannerDismissed for both retry banners', () => {
      setAgent(true)
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      c.dismissBanner()
      expect(c.showRetryBanner.value).toBe(false)
    })

    it('hides banners when error_code is null', () => {
      setActiveTask({ status: 'FAILED', error_code: null })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.showNonRetryableErrorBanner.value).toBe(false)
    })

    it('hides retry banner when status is not FAILED', () => {
      setActiveTask({ status: 'COMPLETED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(false)
    })
  })

  describe('countdown derived state', () => {
    it('shows countdown when retry_after is set on a failed task', () => {
      setActiveTask({ status: 'FAILED', retry_after: new Date(Date.now() + 60_000).toISOString() })
      const c = useTaskChatRetry()
      expect(c.showCountdown.value).toBe(true)
      expect(c.countdown.value).not.toBe('')
    })

    it('promises no retry for a failed task with none scheduled', () => {
      // The core always sends `retry_after`, null when nothing is pending.
      // Before it did, the key was absent — and absent arrives as
      // `undefined`, which is not `null`, so the dashboard promised a retry
      // for every failed task and the countdown never moved.
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT', retry_after: null })
      const c = useTaskChatRetry()
      expect(c.showCountdown.value).toBe(false)
      expect(c.countdown.value).toBe('')
    })

    it('promises no retry for a failed task whose payload omits the key', () => {
      // A core that predates the key sending it at all: the key is absent
      // rather than null, and an absent key is not a scheduled retry.
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT', retry_after: undefined })
      const c = useTaskChatRetry()
      expect(c.showCountdown.value).toBe(false)
      expect(c.countdown.value).toBe('')
    })

    it('promises no retry for an empty retry time', () => {
      // An empty string is not a retry time either: the countdown would
      // render nothing at all next to a promise of an automatic retry.
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT', retry_after: '' })
      const c = useTaskChatRetry()
      expect(c.showCountdown.value).toBe(false)
      expect(c.countdown.value).toBe('')
      // The manual retry banner covers the case where nothing is scheduled.
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('reports canAutoRetry when retries remain', () => {
      setActiveTask({
        status: 'FAILED',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        max_retries: 3,
        retry_count: 0,
      })
      const c = useTaskChatRetry()
      expect(c.canAutoRetry.value).toBe(true)
      expect(c.retriesExhausted.value).toBe(false)
      expect(c.autoRetryDisabled.value).toBe(false)
      expect(c.retryAttempt.value).toBe(1)
      expect(c.maxRetryAttempts.value).toBe(3)
    })

    it('reports retriesExhausted when retry_count >= max_retries', () => {
      setActiveTask({
        status: 'FAILED',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        max_retries: 2,
        retry_count: 2,
      })
      const c = useTaskChatRetry()
      expect(c.canAutoRetry.value).toBe(false)
      expect(c.retriesExhausted.value).toBe(true)
    })

    it('reports autoRetryDisabled for a fresh (non-retry) task with max_retries=0', () => {
      setActiveTask({
        status: 'FAILED',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        max_retries: 0,
        retry_count: 0,
      })
      const c = useTaskChatRetry()
      expect(c.autoRetryDisabled.value).toBe(true)
    })

    it('hides countdown when status is not FAILED', () => {
      setActiveTask({ status: 'COMPLETED', retry_after: new Date(Date.now() + 60_000).toISOString() })
      const c = useTaskChatRetry()
      expect(c.showCountdown.value).toBe(false)
    })
  })

  describe('non-retryable error message', () => {
    it('returns error_message by default', () => {
      setActiveTask({ status: 'FAILED', error_code: 'NO_LLM_CONFIGURATION', error_message: 'No LLM.' })
      const c = useTaskChatRetry()
      expect(c.nonRetryableErrorMessage.value).toBe('No LLM.')
    })

    it('returns failure_reason for UNKNOWN errors', () => {
      setActiveTask({
        status: 'FAILED',
        error_code: 'UNKNOWN',
        error_message: 'Generic message',
        failure_reason: 'Specific reason',
      })
      const c = useTaskChatRetry()
      expect(c.nonRetryableErrorMessage.value).toBe('Specific reason')
    })

    it('falls back to error_message for UNKNOWN errors when no failure_reason', () => {
      setActiveTask({ status: 'FAILED', error_code: 'UNKNOWN', error_message: 'Generic' })
      const c = useTaskChatRetry()
      expect(c.nonRetryableErrorMessage.value).toBe('Generic')
    })

    it('returns null when there is no task', () => {
      const c = useTaskChatRetry()
      expect(c.nonRetryableErrorMessage.value).toBeNull()
    })
  })

  describe('cancelRetryChain', () => {
    it('calls the store and refetches the task on success', async () => {
      setActiveTask()
      const c = useTaskChatRetry()
      await c.cancelRetryChain()
      expect(taskStoreMock.cancelRetryChain).toHaveBeenCalledWith(1)
      expect(taskStoreMock.fetchTask).toHaveBeenCalledWith(1)
      expect(c.cancelling.value).toBe(false)
    })

    it('surfaces an ApiError message via toast and clears the flag', async () => {
      setActiveTask()
      taskStoreMock.cancelRetryChain.mockRejectedValueOnce(new FakeApiError('boom', 'UNKNOWN', 400))
      const c = useTaskChatRetry()
      await c.cancelRetryChain()
      expect(toastMock.error).toHaveBeenCalledWith('boom')
      expect(c.cancelling.value).toBe(false)
    })

    it('shows a generic fallback for non-ApiError rejections', async () => {
      setActiveTask()
      taskStoreMock.cancelRetryChain.mockRejectedValueOnce(new Error('boom'))
      const c = useTaskChatRetry()
      await c.cancelRetryChain()
      expect(toastMock.error).toHaveBeenCalledWith('Failed to cancel retry.')
    })

    it('is a no-op when there is no active task', async () => {
      const c = useTaskChatRetry()
      await c.cancelRetryChain()
      expect(taskStoreMock.cancelRetryChain).not.toHaveBeenCalled()
    })
  })

  describe('retryNow', () => {
    it('suppresses the banner while the retry runs, calls retryTask, refetches detail, and restarts polling', async () => {
      // Simulate the store transitioning FAILED → RUNNING after the retry
      // request resolves. fetchTaskDetail succeeds, then isTerminal flips to
      // false when the next computed read happens, so startDetailPolling runs.
      taskStoreMock.fetchTaskDetail.mockImplementation(async () => {
        activeTaskRef.value = { ...activeTaskRef.value!, status: 'RUNNING' }
        return true
      })
      setActiveTask() // status: 'FAILED' → isTerminal: true
      const c = useTaskChatRetry()
      await c.retryNow()
      // The retry suppresses the banner while it runs; it does not dismiss
      // it — a retry that did not work leaves the operator their banner.
      expect(c.errorBannerDismissed.value).toBe(false)
      expect(taskStoreMock.retryTask).toHaveBeenCalledWith(1)
      expect(taskStoreMock.fetchTaskDetail).toHaveBeenCalledWith(1)
      expect(taskStoreMock.startDetailPolling).toHaveBeenCalledWith(1)
      // The returned task id from retryTask is ignored — retry is in place.
    })

    it('hides the banner while the retry request is in flight', async () => {
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      expect(c.showRetryBanner.value).toBe(true)
      let bannerDuringRequest = true
      taskStoreMock.retryTask.mockImplementation(async () => {
        bannerDuringRequest = c.showRetryBanner.value
        return { id: 99 }
      })
      await c.retryNow()
      expect(bannerDuringRequest).toBe(false)
      // The request never took, so the task is still FAILED — and the
      // banner is the operator's way back.
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('brings the banner back when the retry request fails', async () => {
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      taskStoreMock.retryTask.mockRejectedValueOnce(new Error('nope'))
      await c.retryNow()
      expect(toastMock.error).toHaveBeenCalledWith('Retry failed.')
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('brings the banner back when the task fails again after a retry', async () => {
      // The retry runs in place — same task id — so the run that follows
      // can fail the same task again, and the operator has to see it.
      taskStoreMock.fetchTaskDetail.mockImplementation(async () => {
        activeTaskRef.value = { ...activeTaskRef.value!, status: 'RUNNING' }
        return true
      })
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      await c.retryNow()
      expect(c.showRetryBanner.value).toBe(false)
      activeTaskRef.value = { ...activeTaskRef.value!, status: 'FAILED' }
      await nextTick()
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('keeps an explicit dismissal when the operator retries from the countdown', async () => {
      // The countdown block has its own retry button, and it shows once the
      // operator dismissed the red banner — a retry from there must not
      // bring the dismissed banner back.
      setActiveTask({
        status: 'FAILED',
        error_code: 'RATE_LIMIT',
        retry_after: new Date(Date.now() + 60_000).toISOString(),
      })
      const c = useTaskChatRetry()
      c.dismissBanner()
      expect(c.showRetryBanner.value).toBe(false)
      expect(c.showCountdown.value).toBe(true)
      taskStoreMock.retryTask.mockRejectedValueOnce(new Error('nope'))
      await c.retryNow()
      expect(c.showRetryBanner.value).toBe(false)
      // The countdown stays the surface that carries the retry button.
      expect(c.showCountdown.value).toBe(true)
    })

    it('shows the banner of another task while a retry runs on the first', async () => {
      // The operator opens another failed task while the first one's retry
      // request is in flight. The second task has no retry of its own, and
      // a task with nothing scheduled has no countdown to fall back on —
      // so it must keep its banner.
      setActiveTask({ id: 1, status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      let releaseRetry: () => void = () => {}
      taskStoreMock.retryTask.mockImplementation((): Promise<{ id: number }> => new Promise((resolve) => {
        releaseRetry = () => resolve({ id: 1 })
      }))
      const retry = c.retryNow()
      setActiveTask({ id: 2, status: 'FAILED', error_code: 'RATE_LIMIT' })
      await nextTick()
      expect(c.showRetryBanner.value).toBe(true)
      releaseRetry()
      await retry
    })

    it('shows the retried task\'s banner again once its request settles', async () => {
      setActiveTask({ id: 1, status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      let releaseRetry: () => void = () => {}
      taskStoreMock.retryTask.mockImplementation((): Promise<{ id: number }> => new Promise((resolve) => {
        releaseRetry = () => resolve({ id: 1 })
      }))
      const retry = c.retryNow()
      expect(c.showRetryBanner.value).toBe(false)
      releaseRetry()
      await retry
      // The request never took, so the task is still FAILED — and the
      // banner is the operator's way back.
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('keeps a newer task\'s suppression when an older retry settles', async () => {
      // Two retries can overlap: the operator retries one task, opens
      // another and retries that one too. The first request settling must
      // not clear the second task's suppression.
      setActiveTask({ id: 1, status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      let releaseFirst: () => void = () => {}
      taskStoreMock.retryTask.mockImplementationOnce((): Promise<{ id: number }> => new Promise((resolve) => {
        releaseFirst = () => resolve({ id: 1 })
      }))
      const first = c.retryNow()
      setActiveTask({ id: 2, status: 'FAILED', error_code: 'RATE_LIMIT' })
      await nextTick()
      let releaseSecond: () => void = () => {}
      taskStoreMock.retryTask.mockImplementationOnce((): Promise<{ id: number }> => new Promise((resolve) => {
        releaseSecond = () => resolve({ id: 2 })
      }))
      const second = c.retryNow()
      releaseFirst()
      await first
      // The second task is still retrying — its banner stays hidden.
      expect(c.showRetryBanner.value).toBe(false)
      releaseSecond()
      await second
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('does not restart the polling for a task the operator left mid-fetch', async () => {
      // The retry request resolves and the detail GET goes out; the
      // operator opens another task while the GET is in flight. The
      // polling belongs to the task they retried.
      setActiveTask({ id: 1, status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      let releaseFetch: () => void = () => {}
      taskStoreMock.fetchTaskDetail.mockImplementationOnce((): Promise<boolean> => new Promise((resolve) => {
        releaseFetch = () => resolve(true)
      }))
      const retry = c.retryNow()
      await nextTick()
      expect(taskStoreMock.fetchTaskDetail).toHaveBeenCalledWith(1)
      setActiveTask({ id: 2, status: 'RUNNING' })
      await nextTick()
      releaseFetch()
      await retry
      // The response belongs to the task they left: no polling for it,
      // and the task they opened is the one on screen.
      expect(taskStoreMock.startDetailPolling).not.toHaveBeenCalled()
      expect(activeTaskRef.value?.id).toBe(2)
    })

    it('does not restart polling if the task is still terminal after refetch', async () => {
      taskStoreMock.fetchTaskDetail.mockResolvedValue(true) // status stays FAILED
      setActiveTask()
      const c = useTaskChatRetry()
      await c.retryNow()
      expect(taskStoreMock.retryTask).toHaveBeenCalledWith(1)
      expect(taskStoreMock.fetchTaskDetail).toHaveBeenCalledWith(1)
      expect(taskStoreMock.startDetailPolling).not.toHaveBeenCalled()
    })

    it('toasts the error and does not restart polling when retryTask rejects', async () => {
      setActiveTask()
      taskStoreMock.retryTask.mockRejectedValueOnce(new Error('nope'))
      const c = useTaskChatRetry()
      await c.retryNow()
      expect(toastMock.error).toHaveBeenCalledWith('Retry failed.')
      expect(taskStoreMock.fetchTaskDetail).not.toHaveBeenCalled()
      expect(taskStoreMock.startDetailPolling).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no active task', async () => {
      const c = useTaskChatRetry()
      await c.retryNow()
      expect(taskStoreMock.retryTask).not.toHaveBeenCalled()
      expect(taskStoreMock.fetchTaskDetail).not.toHaveBeenCalled()
      expect(taskStoreMock.startDetailPolling).not.toHaveBeenCalled()
    })
  })

  describe('dismissBanner', () => {
    it('sets errorBannerDismissed to true', () => {
      const c = useTaskChatRetry()
      expect(c.errorBannerDismissed.value).toBe(false)
      c.dismissBanner()
      expect(c.errorBannerDismissed.value).toBe(true)
    })

    it('hides the banner until the task fails again', async () => {
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      c.dismissBanner()
      expect(c.showRetryBanner.value).toBe(false)
      // The dismissal was for the failure it was made for, not for the one
      // that follows a run.
      activeTaskRef.value = { ...activeTaskRef.value!, status: 'RUNNING' }
      await nextTick()
      expect(c.showRetryBanner.value).toBe(false)
      activeTaskRef.value = { ...activeTaskRef.value!, status: 'FAILED' }
      await nextTick()
      expect(c.showRetryBanner.value).toBe(true)
    })

    it('does not carry the dismissal over to another task', async () => {
      setActiveTask({ status: 'FAILED', error_code: 'RATE_LIMIT' })
      const c = useTaskChatRetry()
      c.dismissBanner()
      expect(c.showRetryBanner.value).toBe(false)
      // The router reuses the page component when only the task id
      // changes, so the flag would otherwise outlive the task it was set
      // for.
      activeTaskRef.value = { ...activeTaskRef.value!, id: 2 }
      await nextTick()
      expect(c.showRetryBanner.value).toBe(true)
    })
  })
})
