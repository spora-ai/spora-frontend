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
      const approvedNames = payload.approvals
        .map((a) => taskStore.pendingToolCalls.find((tc) => tc.provider_call_id === a.providerCallId)?.tool_name ?? '')
        .filter(Boolean)
      const summary = approvedNames.length === 0
        ? 'No tools submitted.'
        : approvedNames.length === 1
          ? `Approved: ${approvedNames[0]}.`
          : `Approved ${approvedNames.length} tools.`;
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
