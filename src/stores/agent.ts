import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { Agent, LLMConfigSettings } from '@/types/agent'
import type { Task } from '@/types/task'
import { loadComposerDrafts, saveComposerDrafts, type ComposerDraft } from '@/composables/useComposerDrafts'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'
import type { EffortSelection } from '@/types/effort'
import {
  enableTool,
  disableTool,
  getOperationOverride,
  getAllOperationOverrides,
  patchOperationOverride,
  getLLMConfig,
  putLLMConfig as putLLMConfigRequest,
} from '@/composables/useAgentToolOverrides'

/**
 * Pinia store: agent list, current agent, per-agent task list, composer
 * drafts, per-agent reasoning-effort selection.
 *
 * Tool enable/disable + operation-override HTTP calls live in
 * `@/composables/useAgentToolOverrides`; composer-draft sessionStorage
 * round-trip lives in `@/composables/useComposerDrafts`. The store re-exports
 * those helpers so callers keep using `useAgentStore().enableTool(...)` etc.
 *
 * The reasoning-effort *capability* cache lives in
 * `@/composables/agentEffortCache`. The store drops it wherever the agent's
 * LLM configuration changes, because the capability is the effective
 * driver's level set and the effective config's default.
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
   * The reasoning-effort level the operator picked, per agent.
   *
   * It is not part of the composer draft: the draft is cleared on every
   * successful submit, and an effort level has to survive the message it
   * was picked for. The map is the shared home because the initial composer
   * and the follow-up bar are two surfaces that must agree.
   *
   * An empty string is a value in its own right — the explicit "model
   * default" — so the absence of an entry is what says "not chosen yet".
   *
   * A choice the agent's driver no longer offers does not survive: the
   * backend rejects a level the driver does not declare, so the composable
   * that knows the level set drops it and falls back to the default.
   */
  const effortByAgent = reactive<Record<number, EffortSelection>>({})

  /**
   * `servedUserId` fingerprints the cache: when the auth user drifts away from
   * it (or signs out) the router calls `markStale()` to drop
   * `agents`/`error`/`servedUserId`. Without this fingerprint, an admin's
   * cached agent list leaks to a non-admin who signs in next — the cached row
   * count is non-empty so the router's pre-fetch short-circuits and the
   * dashboard renders the previous user's view.
   *
   * `currentAgent` / `currentAgentTasks` are per-agent view state with their
   * own lifecycle: `clearCurrentAgent()` is the explicit reset path on
   * navigation. They're not part of `markStale()` because the user is
   * currently looking at them.
   */
  const servedUserId = ref<number | null>(null)

  function markStale(): void {
    agents.value = []
    error.value = null
    servedUserId.value = null
    // The effort selection is tied to the agent list the previous user saw.
    for (const agentId of Object.keys(effortByAgent)) {
      delete effortByAgent[Number(agentId)]
    }
    // The cached capability is the same kind of per-user answer, and it
    // lives outside the store: one user's capability must not answer the
    // next user's request.
    clearAgentEffortCache()
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

  /**
   * Save the agent's LLM configuration override.
   *
   * The capability the effort endpoint answers with is the effective
   * driver's level set and the effective config's default — both of which
   * this write changes — so the agent's cached capability goes with it.
   */
  async function putLLMConfig(
    agentId: number,
    settings: LLMConfigSettings,
  ): Promise<LLMConfigSettings> {
    const result = await putLLMConfigRequest(agentId, settings)
    clearAgentEffortCache(agentId)
    return result
  }

  /** The level picked for an agent, or `undefined` when none was picked yet. */
  function getEffortSelection(agentId: number): EffortSelection | undefined {
    return effortByAgent[agentId]
  }

  function setEffortSelection(agentId: number, selection: EffortSelection): void {
    effortByAgent[agentId] = selection
  }

  /**
   * Forget the level picked for an agent.
   *
   * The absence of an entry is what says "not chosen yet", so dropping it
   * leaves the choice to the capability's default again.
   */
  function clearEffortSelection(agentId: number): void {
    delete effortByAgent[agentId]
  }

  async function fetchAgents(principalIds?: number[] | null): Promise<void> {
    // `?principal_id=` is repeatable on the backend; the client's query
    // builder emits an array as repeated keys
    // (`?principal_id=a&principal_id=b`).
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
    speech_driver_config_id?: number | null
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
      speech_driver_config_id: number | null
      max_steps: number
      allow_followup: boolean
      retry_after_minutes: number
      max_retries: number
      is_pinned: boolean
      is_archived: boolean
    }>,
  ): Promise<Agent> {
    const result = await api.patch<{ agent: Agent }>(`/agents/${id}`, data)
    const idx = agents.value.findIndex((a) => a.id === id)
    if (idx !== -1) agents.value[idx] = result.agent
    if (currentAgent.value?.id === id) currentAgent.value = result.agent
    if (data.llm_driver_config_id !== undefined) {
      // The effective driver decides the level set and the effective
      // config's default, so the cached capability is no longer the truth.
      clearAgentEffortCache(id)
    }
    return result.agent
  }

  /**
   * Toggle the per-user favourite via the dedicated endpoints. PATCH
   * /agents/{id} no longer accepts `is_favorite` — the column is gone in
   * favour of a per-user pivot row, and the toggle lives at
   * POST/DELETE /agents/{id}/favorite. Re-fetches the row so the store
   * reflects the new `is_favorite` value (the toggle response is a
   * `{data: {is_favorite: bool}}` envelope, not the full agent).
   */
  async function setFavorite(id: number, isFavorite: boolean): Promise<Agent> {
    if (isFavorite) {
      await api.post<{ data: { is_favorite: true } }>(`/agents/${id}/favorite`)
    } else {
      await api.delete<{ data: { is_favorite: false } }>(`/agents/${id}/favorite`)
    }
    const result = await api.get<{ agent: Agent }>(`/agents/${id}`)
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
   * `currentAgent` slot so the AgentSidebar re-buckets the agent under its new
   * owner (My Agents ↔ Group · {name}) and the OwnerBadge on the settings page
   * re-resolves against the new principal — without a full `fetchAgents()`
   * round-trip. Same pattern as `updateAgent` / `updateProfilePicture`: the
   * API response carries the canonical row, so we trust the server-side join.
   *
   * Backend: `POST /api/v1/agents/{id}/transfer` body `{ principal_id }`. Both
   * source and target principal must be controllable by the caller (admin or
   * owner); enforced server-side.
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
    effortByAgent,
    fetchAgents,
    fetchAgent,
    createAgent,
    updateAgent,
    setFavorite,
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
    getEffortSelection,
    setEffortSelection,
    clearEffortSelection,
  }
})
