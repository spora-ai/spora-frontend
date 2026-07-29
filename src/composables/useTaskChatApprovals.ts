import { ref } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'

export type Decision = {
  providerCallId: string
  decision: 'approve' | 'reject'
  arguments?: Record<string, unknown>
  reason?: string
}

export function summarizeDecisions(
  decisions: ReadonlyArray<{ providerCallId: string; decision: 'approve' | 'reject' }>,
  resolveName: (providerCallId: string) => string | undefined,
): string {
  const approvals = decisions.filter(decision => decision.decision === 'approve')
  const rejections = decisions.filter(decision => decision.decision === 'reject')
  if (decisions.length === 0) return 'No decisions submitted.'
  if (rejections.length === 0) {
    if (approvals.length === 1) {
      const name = resolveName(approvals[0]!.providerCallId)
      return name ? `Approved: ${name}.` : 'Approved 1 tool.'
    }
    return `Approved ${approvals.length} tools.`
  }
  if (approvals.length === 0) return `Rejected ${rejections.length} ${rejections.length === 1 ? 'tool' : 'tools'}.`
  return `Approved ${approvals.length} ${approvals.length === 1 ? 'tool' : 'tools'}, rejected ${rejections.length}.`
}

export function summarizeApprovals(
  approvals: ReadonlyArray<{ providerCallId: string }>,
  resolveName: (providerCallId: string) => string | undefined,
): string {
  return summarizeDecisions(approvals.map(approval => ({ ...approval, decision: 'approve' })), resolveName)
}

export function useTaskChatApprovals(taskId: { value: number }, onAfterMutation: () => void) {
  const taskStore = useTaskStore()
  const toast = useToast()
  const approveError = ref<string | null>(null)
  const submitting = ref(false)
  const rejecting = ref(false)

  async function onSubmitDecisions(payload: { decisions: Decision[] }): Promise<void> {
    approveError.value = null
    submitting.value = true
    try {
      const summary = summarizeDecisions(payload.decisions, id =>
        taskStore.pendingToolCalls.find(tc => tc.provider_call_id === id)?.tool_name,
      )
      await taskStore.approveTask(taskId.value, payload.decisions)
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

  return { approveError, submitting, rejecting, onSubmitDecisions, onRejectAll }
}
