/**
 * useTaskChatRetry — retry-banner, countdown, and cancel/retry actions for
 * the TaskChatPage. The pure derived-state math lives in
 * `@/composables/useTaskChat`; this file wires it to the task store.
 */
import { computed, ref, watch } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import {
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
  formatCountdown,
  computeRetryState,
} from '@/composables/useTaskChat'
import { i18n } from '@/i18n'

export function useTaskChatRetry() {
  const taskStore = useTaskStore()
  const toast = useToast()

  // The operator's explicit dismissal of the failure banner. It belongs to
  // the failure it was made for — another task, or the same task failing
  // again, gets its own banner.
  const errorBannerDismissed = ref(false)
  // The tasks with a retry request in flight. The ids, not a boolean: a
  // request for one task must not hide the banner of another task the
  // operator opened while it runs — that task would have no way to retry
  // at all, and no countdown to fall back on.
  const retryingTaskIds = ref<Set<number>>(new Set())
  const cancelling = ref(false)

  const task = computed(() => taskStore.activeTask)

  // True while the task on screen is the one whose retry is running.
  const isRetrying = computed(() =>
    task.value !== null && retryingTaskIds.value.has(task.value.id)
  )

  // The dismissal belongs to one failure of one task. The task running
  // again makes a new failure, and another task's banner is not this
  // task's dismissal either — the router reuses the page component when
  // only the task id changes, so the flag outlives the task it was set
  // for.
  watch(
    () => task.value?.status,
    (status, previous) => {
      if (status === 'FAILED' && previous !== undefined && previous !== 'FAILED') {
        errorBannerDismissed.value = false
      }
    },
  )

  watch(
    () => task.value?.id,
    () => {
      errorBannerDismissed.value = false
    },
  )

  // Retryable error banner — shows the "Retry Now" CTA.
  const showRetryBanner = computed(() => {
    if (!task.value) return false
    if (task.value.status !== 'FAILED') return false
    if (errorBannerDismissed.value || isRetrying.value) return false
    if (task.value.error_code === null) return false
    if (!RETRYABLE_ERROR_CODES.includes(task.value.error_code as typeof RETRYABLE_ERROR_CODES[number])) return false
    if (!task.value.retry_after) {
      // Nothing is scheduled, so this banner is the only way back. The
      // core arms a retry only while the budget lasts and clears the
      // chain marker when it ends, so a task whose budget is spent comes
      // back with no retry time — and with no banner the operator has no
      // way to retry the task at all.
      return true
    }
    if (autoRetryConfigured.value || retriesExhausted.value) return false
    if ((task.value.max_retries ?? 0) === 0) return true
    return false
  })

  // Non-retryable error banner (NO_LLM_CONFIGURATION, UNKNOWN, ...).
  const showNonRetryableErrorBanner = computed(() => {
    if (!task.value) return false
    if (task.value.status !== 'FAILED') return false
    if (errorBannerDismissed.value || isRetrying.value) return false
    if (task.value.error_code === null) return false
    if (RETRYABLE_ERROR_CODES.includes(task.value.error_code as typeof RETRYABLE_ERROR_CODES[number])) return false
    if (!NON_RETRYABLE_ERROR_CODES.includes(task.value.error_code as typeof NON_RETRYABLE_ERROR_CODES[number])) return false
    return true
  })

  // For UNKNOWN errors, show raw failure_reason since error_message is generic.
  const nonRetryableErrorMessage = computed(() => {
    if (!task.value) return null
    if (task.value.error_code === 'UNKNOWN') {
      return task.value.failure_reason || task.value.error_message
    }
    return task.value.error_message
  })

  // Countdown for auto-retry (retry_after set but not yet elapsed).
  //
  // The countdown shows only when a retry time is really there. "Absent",
  // "null" and "" all mean nothing is pending, and the countdown renders
  // an empty string for them — a promise of a retry that never comes. The
  // manual retry banner covers the case where nothing is scheduled.
  const showCountdown = computed(() => {
    const retryAfter = task.value?.retry_after
    return task.value?.status === 'FAILED' && Boolean(retryAfter)
  })

  const countdown = computed(() => formatCountdown(task.value?.retry_after))

  // Aggregate retry-related derived state from the task snapshot.
  const retryState = computed(() => computeRetryState(
    task.value?.retry_of_task_id,
    task.value?.max_retries,
    task.value?.retry_count,
  ))

  const autoRetryConfigured = computed(() => retryState.value.autoRetryConfigured)
  const retryAttempt = computed(() => retryState.value.retryAttempt)
  const maxRetryAttempts = computed(() => retryState.value.maxRetryAttempts)
  const canAutoRetry = computed(() => retryState.value.canAutoRetry)
  const retriesExhausted = computed(() => retryState.value.retriesExhausted)
  const autoRetryDisabled = computed(() => retryState.value.autoRetryDisabled)

  async function cancelRetryChain(): Promise<void> {
    if (!task.value) return
    cancelling.value = true
    try {
      await taskStore.cancelRetryChain(task.value.id)
      await taskStore.fetchTask(task.value.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : i18n.global.t('Failed to cancel retry.'))
    } finally {
      cancelling.value = false
    }
  }

  async function retryNow(): Promise<void> {
    if (!task.value) return
    // The task the operator clicked Retry on, captured before the request:
    // the operator may open another task while it runs, and the
    // suppression belongs to the task that was retried.
    const taskId = task.value.id
    retryingTaskIds.value = new Set(retryingTaskIds.value).add(taskId)
    try {
      // POST /tasks/{id}/retry now re-runs the failed task in place on the
      // backend (same task_id, full conversation history preserved). The
      // reactive task store + Mercure SSE push the new RUNNING state into the
      // same view — no router.push is needed and would actively break the
      // in-place semantics by navigating the user to a different URL.
      await taskStore.retryTask(taskId)
      // The store stops detail polling when the task enters a terminal status
      // (FAILED/COMPLETED), so the previous FAILED state is no longer being
      // polled. Re-fetch the task to pick up the new RUNNING status, then
      // restart polling — same pattern as useTaskChatFollowup.submitFollowup.
      //
      // Only while the retried task is the one on screen: the store replaces
      // the active task with whatever it fetches, and the operator may have
      // opened another task while the request ran.
      if (taskStore.activeTask?.id === taskId) {
        await taskStore.fetchTaskDetail(taskId)
        // The GET is a round trip, and the operator may have opened
        // another task while it was in flight. The polling belongs to the
        // task they retried — not to the one they opened.
        if (taskStore.activeTask?.id === taskId && !taskStore.isTerminal) {
          taskStore.startDetailPolling(taskId)
        }
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : i18n.global.t('Retry failed.'))
    } finally {
      // The banner is not dismissed, only suppressed: a retry that did not
      // work leaves the task FAILED, and the banner is the operator's only
      // way back. A retry that worked moves the task out of FAILED, and
      // the status keeps the banner hidden on its own.
      //
      // Only this task's id comes off the set: a retry for another task may
      // have started while this one ran, and that request owns its own
      // suppression.
      const pending = new Set(retryingTaskIds.value)
      pending.delete(taskId)
      retryingTaskIds.value = pending
    }
  }

  function dismissBanner(): void {
    errorBannerDismissed.value = true
  }

  return {
    errorBannerDismissed,
    isRetrying,
    cancelling,
    showRetryBanner,
    showNonRetryableErrorBanner,
    nonRetryableErrorMessage,
    showCountdown,
    countdown,
    autoRetryConfigured,
    retryAttempt,
    maxRetryAttempts,
    canAutoRetry,
    retriesExhausted,
    autoRetryDisabled,
    cancelRetryChain,
    retryNow,
    dismissBanner,
  }
}
