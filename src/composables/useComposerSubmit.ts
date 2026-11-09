/**
 * useComposerSubmit — submission flow for the ComposerInput prompt box.
 *
 * Owns: the submitting flag, the composerError message, and the `submit`
 * action that validates the trimmed prompt, calls
 * `taskStore.createTaskForAgent`, clears the per-agent draft, and navigates to
 * /tasks/:id. Surfaces ApiError via the `error` ref so the page can render it.
 *
 * The caller passes a `getAgentId: () => number` rather than a bare number —
 * Vue Router reuses the AgentPage (and its ComposerInput) across
 * `/agents/:id` navigations, so the setup closure runs once with the initial
 * id and a captured value would lag the route. The getter is invoked at
 * submit time so the request always targets the agent currently mounted in
 * the composer.
 *
 * `getEffort` is read the same way: the reasoning-effort level belongs to
 * the agent, and the composer is reused across agents. `undefined` means the
 * capability is unknown, and the request then carries no `effort` at all.
 *
 * `onEffortLevelUnsupported` is called when the backend refuses the level
 * because the agent's driver does not declare it: the capability the client
 * holds is out of date, and the caller is the one that knows how to ask
 * for a fresh one.
 *
 * Accepts an optional `mediaIds: string[]` so the composer's upload
 * affordance can attach previously uploaded media to the prompt.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { ApiError } from '@/api/client'
import { isEffortLevelUnsupported } from '@/composables/agentEffortCache'
import { i18n } from '@/i18n'
import type { EffortSelection } from '@/types/effort'

export function useComposerSubmit(
  getAgentId: () => number,
  getEffort: () => EffortSelection | undefined = () => undefined,
  onEffortLevelUnsupported: (agentId: number) => void | Promise<void> = () => undefined,
) {
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
    const agentId = getAgentId()
    try {
      const task = await taskStore.createTaskForAgent(agentId, text, {
        mediaIds,
        effort: getEffort(),
      })
      agentStore.clearComposerDraft(agentId)
      await router.push({ name: 'task', params: { id: task.id } })
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : i18n.global.t('Failed to start task.')
      if (isEffortLevelUnsupported(e)) {
        // The driver's level set moved on: the capability the client holds
        // is what the backend refused. Ask again, so the next message
        // carries a level the driver still has. The refusal itself stays
        // on screen — the operator has to read what went wrong.
        await onEffortLevelUnsupported(agentId)
      }
    } finally {
      submitting.value = false
    }
  }

  return { submitting, error, submit }
}
