/**
 * useTaskChatFollowup — follow-up prompt state + submit for TaskChatPage.
 *
 * Shown when the task is COMPLETED, FAILED, or ABORTED and the agent allows
 * continuation. Submits via `taskStore.continueTask` and restarts detail
 * polling on the RUNNING/COMPLETED source branch. The auto-abort path
 * (sending a message to a RUNNING task) routes through the same submission
 * entry point — Orchestrator::continue flips the status to ABORTED and
 * writes the user's prompt + a marker row in one transaction.
 */
import { ref, computed } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { ApiError } from '@/api/client'

/**
 * Reusable predicate exposed for templates that want to render their own
 * "send follow-up" affordance outside the standard follow-up bar.
 */
export function shouldShowFollowupBar(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'ABORTED'
}

export function useTaskChatFollowup() {
  const taskStore = useTaskStore()
  const agentStore = useAgentStore()

  const followupPrompt = ref('')
  const submittingFollowup = ref(false)
  const followupError = ref<string | null>(null)

  const task = computed(() => taskStore.activeTask)

  const showFollowupBar = computed(() => {
    if (!task.value) return false
    if (!shouldShowFollowupBar(task.value.status)) return false
    const agent = agentStore.currentAgent
    if (!agent) return false
    return agent.allow_followup !== false
  })

  /**
   * State-aware placeholder string for the follow-up input. ABORTED
   * surfaces a redirect cue so the user knows the typed message will
   * resume the agent rather than start a new turn.
   */
  const followupPlaceholder = computed(() => {
    if (task.value?.status === 'ABORTED') {
      return 'Send a new instruction to continue…'
    }
    return 'Ask a follow-up question…'
  })

  async function submitFollowup(): Promise<void> {
    const text = followupPrompt.value.trim()
    if (!text || !task.value) return
    followupError.value = null
    submittingFollowup.value = true
    try {
      await taskStore.continueTask(task.value.id, text)
      await taskStore.fetchTaskDetail(task.value.id)
      if (!taskStore.isTerminal) {
        taskStore.startDetailPolling(task.value.id)
      }
      followupPrompt.value = ''
    } catch (e) {
      followupError.value = e instanceof ApiError ? e.message : 'Failed to submit follow-up.'
    } finally {
      submittingFollowup.value = false
    }
  }

  return {
    followupPrompt,
    submittingFollowup,
    followupError,
    showFollowupBar,
    followupPlaceholder,
    submitFollowup,
  }
}
