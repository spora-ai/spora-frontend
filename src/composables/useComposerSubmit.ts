/**
 * useComposerSubmit — submission flow for the ComposerInput prompt box.
 *
 * Owns: the submitting flag, the composerError message, and the `submit` action
 * that validates the trimmed prompt, calls taskStore.createTaskForAgent, clears
 * the per-agent draft, and navigates to /tasks/:id. Surfaces ApiError via the
 * `error` ref so the page can render it.
 *
 * Accepts an optional `mediaIds: string[]` so the composer's upload affordance
 * can attach previously uploaded media to the prompt.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { ApiError } from '@/api/client'

export function useComposerSubmit(agentId: number) {
  const taskStore = useTaskStore()
  const agentStore = useAgentStore()
  const router = useRouter()

  const submitting = ref(false)
  const error = ref<string | null>(null)

  async function submit(prompt: string, mediaIds: string[] = []): Promise<void> {
    const text = prompt.trim()
    if (!text) return
    error.value = null
    submitting.value = true
    try {
      const task = await taskStore.createTaskForAgent(agentId, text, undefined, mediaIds)
      agentStore.clearComposerDraft(agentId)
      await router.push({ name: 'task', params: { id: task.id } })
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to start task.'
    } finally {
      submitting.value = false
    }
  }

  return { submitting, error, submit }
}
