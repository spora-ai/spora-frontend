import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'
import { loadComposerDrafts, saveComposerDrafts, type ComposerDraft } from '@/composables/useComposerDrafts'
import {
  enableTool,
  disableTool,
  getOperationOverride,
  getAllOperationOverrides,
  patchOperationOverride,
  getLLMConfig,
  putLLMConfig,
} from '@/composables/useAgentToolOverrides'

/**
 * Pinia store: agent list, current agent, per-agent task list, composer drafts.
 *
 * Tool enable/disable + operation-override HTTP calls live in
 * `@/composables/useAgentToolOverrides`; composer-draft sessionStorage
 * round-trip lives in `@/composables/useComposerDrafts`. The store re-exports
 * those helpers so callers keep using `useAgentStore().enableTool(...)` etc.
 */
export const useAgentStore = defineStore('agent', () => {
  const agents = ref<Agent[]>([])
  const currentAgent = ref<Agent | null>(null)
  const currentAgentTasks = ref<Task[]>([])
  const tasksCurrentPage = ref(1)
  const tasksHasMore = ref(false)
  const tasksTotal = ref(0)
  const tasksLoading = ref(false)
  const error = ref<string | null>(null)
  const composerDrafts = reactive<Record<number, ComposerDraft>>(loadComposerDrafts())

  /**
   * `servedUserId` fingerprints the cache: when the auth user drifts
   * away from it (or signs out) the router calls `markStale()` to drop
   * `agents`/`error`/`servedUserId`. Without this fingerprint, an
   * admin's cached agent list leaks to a non-admin who signs in next
   * — the cached row count is non-empty so the router's pre-fetch
   * short-circuits and the dashboard renders the previous user's
   * view.
   *
   * `currentAgent` / `currentAgentTasks` are per-agent view state
   * with their own lifecycle: `clearCurrentAgent()` is the explicit
   * reset path on navigation. They're not part of `markStale()`
   * because the user is currently looking at them.
   */
  const servedUserId = ref<number | null>(null)

  function markStale(): void {
    agents.value = []
    error.value = null
    servedUserId.value = null
  }

  // Auto-persist drafts to sessionStorage on any mutation.
  watch(composerDrafts, (drafts) => {
    saveComposerDrafts(drafts)
  }, { deep: true })

  function getComposerDraft(agentId: number): ComposerDraft {
    if (!composerDrafts[agentId]) {
      // Attachments travel alongside promptText so the chip list survives
      // remounts (e.g. leaving and returning to the agent page).
      composerDrafts[agentId] = { promptText: '', attachments: [] }
    }
    return composerDrafts[agentId]
  }

  function clearComposerDraft(agentId: number): void {
    const draft = composerDrafts[agentId]
    if (!draft) {
      return
    }
    draft.promptText = ''
    draft.attachments = []
  }

  async function fetchAgents(principalIds?: number[] | null): Promise<void> {
    // `?principal_id=` is repeatable on the backend; pass the array via
    // a custom query builder so axios emits it as `?principal_id=a&principal_id=b`.
    const query: Record<string, unknown> = {}
    if (principalIds !== undefined && principalIds !== null && principalIds.length > 0) {
      query['principal_id'] = principalIds
    }
    const result = await api.get<{ agents: Agent[] }>('/agents', query)
    // Guard the assignment: a malformed response would leave `agents.value`
    // undefined and crash any consumer doing `.find` / `.filter` on it.
    agents.value = result.agents ?? []
    // Stamp the cache under the caller's user id. The router uses this
    // fingerprint to detect an auth change and trigger `markStale()`. We
    // read the auth store lazily so tests that don't bootstrap auth still
    // work (and so we don't create a circular module-init order).
    servedUserId.value = useAuthStore().user?.id ?? null
  }

  async function fetchAgent(id: number): Promise<Agent> {
    const result = await api.get<{ agent: Agent }>(`/agents/${id}`)
    currentAgent.value = result.agent
    return result.agent
  }

  async function createAgent(data: {
    name: string
    description?: string
    system_prompt?: string
    llm_driver_config_id?: number | null
    max_steps?: number
    principal_id?: number | null
  }): Promise<Agent> {
    const result = await api.post<{ agent: Agent }>('/agents', data)
    agents.value.unshift(result.agent)
    return result.agent
  }

  async function updateAgent(
    id: number,
    data: Partial<{
      name: string
      description: string | null
      system_prompt: string | null
      notes: string | null
      llm_driver_config_id: number | null
      max_steps: number
      allow_followup: boolean
      retry_after_minutes: number
      max_retries: number
      is_pinned: boolean
      is_archived: boolean
      is_favorite: boolean
    }>,
  ): Promise<Agent> {
    const result = await api.patch<{ agent: Agent }>(`/agents/${id}`, data)
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = result.agent
    if (currentAgent.value?.id === id) currentAgent.value = result.agent
    return result.agent
  }

  /**
   * PATCH the agent's profile picture metadata (archetype / variant_key /
   * palette_key). The image-vs-avatar switch is implicit: sending any of
   * the three fields always resets the picture to an archetype avatar and
   * clears any uploaded image; pass `image: true` to switch to the
   * uploaded image (the most recent `POST /picture/image`).
   */
  async function updateProfilePicture(
    id: number,
    picture: Partial<{
      archetype: string | null
      variant_key: string | null
      palette_key: string | null
      image: boolean
    }>,
  ): Promise<Agent> {
    const result = await api.patch<{ agent: Agent }>(`/agents/${id}`, {
      profile_picture: picture,
    })
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = result.agent
    if (currentAgent.value?.id === id) currentAgent.value = result.agent
    return result.agent
  }

  /**
   * Upload a new picture image (multipart). 1 MiB cap, PNG/JPEG/WebP.
   * The returned Agent carries the resolved `profile_picture` (kind=image).
   */
  async function uploadProfilePictureImage(id: number, file: File): Promise<Agent> {
    const form = new FormData()
    form.append('file', file)
    const result = await api.postForm<{ agent: Agent }>(`/agents/${id}/picture/image`, form)
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = result.agent
    if (currentAgent.value?.id === id) currentAgent.value = result.agent
    return result.agent
  }

  /**
   * Remove the uploaded picture image. The agent reverts to its
   * archetype avatar (or the default if no archetype was ever picked).
   */
  async function deleteProfilePictureImage(id: number): Promise<Agent> {
    const result = await api.delete<{ agent: Agent }>(`/agents/${id}/picture/image`)
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = result.agent
    if (currentAgent.value?.id === id) currentAgent.value = result.agent
    return result.agent
  }

  async function deleteAgent(id: number): Promise<void> {
    await api.delete(`/agents/${id}`)
    agents.value = agents.value.filter((a) => a.id !== id)
    if (currentAgent.value?.id === id) {
      currentAgent.value = null
      currentAgentTasks.value = []
    }
  }

  /**
   * Transfer an agent to a different principal (user or group).
   *
   * On success, optimistically updates the row in `agents` and the
   * `currentAgent` slot so the AgentSidebar re-buckets the agent under
   * its new owner (My Agents ↔ Group · {name}) and the OwnerBadge on
   * the settings page re-resolves against the new principal — without
   * a full `fetchAgents()` round-trip. Same pattern as `updateAgent`
   * / `updateProfilePicture`: the API response carries the canonical
   * row, so we trust the server-side join.
   *
   * Backend: `POST /api/v1/agents/{id}/transfer` body `{ principal_id }`.
   * Both source and target principal must be controllable by the caller
   * (admin or owner); enforced server-side.
   */
  async function transferAgent(id: number, principalId: number): Promise<Agent> {
    const result = await api.post<{ agent: Agent }>(`/agents/${id}/transfer`, {
      principal_id: principalId,
    })
    const updated = result.agent
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = updated
    if (currentAgent.value?.id === id) currentAgent.value = updated
    return updated
  }

  async function fetchAgentTasks(agentId: number, options?: { page?: number }): Promise<void> {
    const page = options?.page ?? 1
    const params = new URLSearchParams({ agent_id: String(agentId), page: String(page) })
    const result = await api.get<{
      tasks: Task[]
      meta?: { current_page: number; last_page: number; per_page: number; total: number }
    }>(`/tasks?${params}`)
    if (page === 1) {
      currentAgentTasks.value = result.tasks
    } else {
      currentAgentTasks.value.push(...result.tasks)
    }
    if (result.meta) {
      tasksCurrentPage.value = result.meta.current_page
      tasksHasMore.value = result.meta.current_page < result.meta.last_page
      tasksTotal.value = result.meta.total
    }
  }

  async function loadMoreTasks(): Promise<void> {
    if (!tasksHasMore.value) return
    const agentId = currentAgent.value?.id
    if (!agentId) return
    tasksLoading.value = true
    try {
      await fetchAgentTasks(agentId, { page: tasksCurrentPage.value + 1 })
    } finally {
      tasksLoading.value = false
    }
  }

  async function deleteTask(taskId: number): Promise<void> {
    await api.delete(`/tasks/${taskId}`)
    currentAgentTasks.value = currentAgentTasks.value.filter(t => t.id !== taskId)
  }

  /**
   * Apply an SSE task event to currentAgentTasks. Called by `useRealtime`
   * (real-time path) and the dashboard polling fallback (SSE-off path).
   * Only applies updates for tasks belonging to the currentAgent.
   */
  function applySseTaskEvent(data: Record<string, unknown>): void {
    const taskId = (data.id ?? data.task_id) as number | undefined
    if (taskId === undefined) return

    const taskAgentId = (data as { agent_id?: number }).agent_id
    if (currentAgent.value !== null && taskAgentId !== undefined && taskAgentId !== currentAgent.value.id) {
      return
    }

    const idx = currentAgentTasks.value.findIndex(t => t.id === taskId)
    if (idx !== -1) {
      Object.assign(currentAgentTasks.value[idx], {
        status: (data.status as Task['status']) ?? currentAgentTasks.value[idx].status,
        step_count: (data.step_count as number) ?? currentAgentTasks.value[idx].step_count,
        final_response: (data.final_response as string | null) ?? currentAgentTasks.value[idx].final_response,
        updated_at: (data.updated_at as string) ?? currentAgentTasks.value[idx].updated_at,
      })
    } else if (data.status !== undefined) {
      currentAgentTasks.value.unshift({
        id: taskId,
        agent_id: taskAgentId ?? currentAgent.value?.id ?? 0,
        status: data.status as Task['status'],
        user_prompt: (data as { user_prompt?: string }).user_prompt ?? '',
        final_response: (data.final_response as string | null) ?? null,
        step_count: (data.step_count as number) ?? 0,
        max_steps: null,
        updated_at: (data.updated_at as string) ?? new Date().toISOString(),
        created_at: (data.created_at as string) ?? new Date().toISOString(),
      })
    }
  }

  function clearCurrentAgent(): void {
    currentAgent.value = null
    currentAgentTasks.value = []
    tasksCurrentPage.value = 1
    tasksHasMore.value = false
    tasksTotal.value = 0
  }

  return {
    agents,
    servedUserId,
    error,
    currentAgent,
    currentAgentTasks,
    tasksCurrentPage,
    tasksHasMore,
    tasksTotal,
    tasksLoading,
    composerDrafts,
    fetchAgents,
    fetchAgent,
    createAgent,
    updateAgent,
    updateProfilePicture,
    uploadProfilePictureImage,
    deleteProfilePictureImage,
    deleteAgent,
    transferAgent,
    fetchAgentTasks,
    loadMoreTasks,
    deleteTask,
    applySseTaskEvent,
    enableTool,
    disableTool,
    getOperationOverride,
    getAllOperationOverrides,
    patchOperationOverride,
    getLLMConfig,
    putLLMConfig,
    markStale,
    clearCurrentAgent,
    getComposerDraft,
    clearComposerDraft,
  }
})
