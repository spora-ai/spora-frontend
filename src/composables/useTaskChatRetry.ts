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
  // A retry request is in flight. The banner is suppressed while it runs,
  // not dismissed: the task stays FAILED until the store learns that the
  // retry took, and a retry that did not work leaves the operator needing
  // the banner again.
  const retrying = ref(false)
  const cancelling = ref(false)

  const task = computed(() => taskStore.activeTask)

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
    if (errorBannerDismissed.value || retrying.value) return false
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
    if (errorBannerDismissed.value || retrying.value) return false
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
    retrying.value = true
    try {
      // POST /tasks/{id}/retry now re-runs the failed task in place on the
      // backend (same task_id, full conversation history preserved). The
      // reactive task store + Mercure SSE push the new RUNNING state into the
      // same view — no router.push is needed and would actively break the
      // in-place semantics by navigating the user to a different URL.
      await taskStore.retryTask(task.value.id)
      // The store stops detail polling when the task enters a terminal status
      // (FAILED/COMPLETED), so the previous FAILED state is no longer being
      // polled. Re-fetch the task to pick up the new RUNNING status, then
      // restart polling — same pattern as useTaskChatFollowup.submitFollowup.
      await taskStore.fetchTaskDetail(task.value.id)
      if (!taskStore.isTerminal) {
        taskStore.startDetailPolling(task.value.id)
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : i18n.global.t('Retry failed.'))
    } finally {
      // The banner is not dismissed, only suppressed: a retry that did not
      // work leaves the task FAILED, and the banner is the operator's only
      // way back. The task's own status keeps it hidden while the retry
      // runs.
      retrying.value = false
    }
  }

  function dismissBanner(): void {
    errorBannerDismissed.value = true
  }

  return {
    errorBannerDismissed,
    retrying,
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
