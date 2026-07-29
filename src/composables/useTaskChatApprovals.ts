/**
 * useTaskChatApprovals — submit + bulk-reject handlers for the new
 * "must decide on every card" approval flow in {@see ToolApprovalBar}.
 *
 * The bar owns the per-card decision state; this composable owns the HTTP
 * path. Two paths:
 *   - {@link onSubmitDecisions}: posts the decided-approved batch to
 *     `/api/v1/tasks/{id}/approve`. The backend (PR #171) leaves
 *     un-approved cards in pending_state, so users can keep deciding
 *     on a later round if they choose to.
 *   - {@link onRejectAll}: one-shot bulk reject that cancels the task.
 */
import { ref } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'

/**
 * Builds the toast summary for a submit-decisions response.
 *
 * Counts approvals, not resolved tool names — a missing tool_name should
 * never collapse "1 approved" into "No tools submitted." When a name is
 * available we use it for the single-approval case; otherwise we fall
 * back to the plural form ("Approved 1 tool.").
 */
export function summarizeApprovals(
  approvals: ReadonlyArray<{ providerCallId: string }>,
  resolveName: (providerCallId: string) => string | undefined,
): string {
  const count = approvals.length
  if (count === 0) {
    return 'No tools submitted.'
  }
  if (count === 1) {
    const name = resolveName(approvals[0]!.providerCallId)
    return name ? `Approved: ${name}.` : 'Approved 1 tool.'
  }
  return `Approved ${count} tools.`
}

export function useTaskChatApprovals(taskId: { value: number }, onAfterMutation: () => void) {
  const taskStore = useTaskStore()
  const toast = useToast()

  const approveError = ref<string | null>(null)
  const submitting = ref(false)
  const rejecting = ref(false)

  async function onSubmitDecisions(payload: {
    approvals: Array<{ providerCallId: string; arguments: Record<string, unknown> }>
  }): Promise<void> {
    approveError.value = null
    submitting.value = true
    try {
      const approvals = payload.approvals.map((a) => ({
        provider_call_id: a.providerCallId,
        arguments: a.arguments,
      }))
      const summary = summarizeApprovals(payload.approvals, (id) =>
        taskStore.pendingToolCalls.find((tc) => tc.provider_call_id === id)?.tool_name,
      )
      await taskStore.approveTask(taskId.value, approvals)
      toast.success(summary)
      taskStore.startDetailPolling(taskId.value)
      onAfterMutation()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Approval failed.'
      toast.error(msg)
      approveError.value = msg
    } finally {
      submitting.value = false
    }
  }

  async function onRejectAll(payload: { reason: string }): Promise<void> {
    rejecting.value = true
    approveError.value = null
    try {
      await taskStore.rejectTask(taskId.value, payload.reason)
      toast.success('All tools rejected.')
      taskStore.startDetailPolling(taskId.value)
      onAfterMutation()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Rejection failed.'
      toast.error(msg)
      approveError.value = msg
    } finally {
      rejecting.value = false
    }
  }

  return {
    approveError,
    submitting,
    rejecting,
    onSubmitDecisions,
    onRejectAll,
  }
}
