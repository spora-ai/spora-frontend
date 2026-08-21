/**
 * groupDetail store — fetches and mutates one group's resources.
 *
 * Reset on dialog close (i.e. when navigating away from the group) so
 * stale counts and members don't leak across groups. The detail page
 * calls `reset()` from `onUnmounted`; the per-resource fetchers are
 * idempotent so navigating between sub-pages is cheap.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { groupsApi, type ToolSetting, type GroupLlmConfigPayload, type GroupLlmConfigUpdatePayload, type GroupPreferences } from '@/api/groups'
import { ApiError } from '@/api/client'
import type { Group, GroupMember } from '@/types/principal'

interface GroupAgentSummary {
  id: number
  name: string
  principal_id?: number
  created_at?: string
}

export const useGroupDetailStore = defineStore('groupDetail', () => {
  const group = ref<Group | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const members = ref<GroupMember[]>([])
  const agents = ref<GroupAgentSummary[]>([])
  const preferences = ref<GroupPreferences | null>(null)
  const toolSettings = ref<ToolSetting[]>([])
  const llmConfigs = ref<Array<Record<string, unknown>>>([])

  let loadedId: number | null = null

  function setLoaded(id: number | null): void {
    loadedId = id
  }

  async function fetchDetail(id: number): Promise<Group> {
    loading.value = true
    error.value = null
    try {
      const detail = await groupsApi.get(id)
      group.value = detail
      loadedId = id
      return detail
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load group.'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchMembers(id: number): Promise<GroupMember[]> {
    const list = await groupsApi.listMembers(id)
    members.value = list
    return list
  }

  async function fetchAgents(id: number): Promise<GroupAgentSummary[]> {
    const result = await groupsApi.agents(id)
    agents.value = (result.agents ?? []) as unknown as GroupAgentSummary[]
    return agents.value
  }

  async function fetchPreferences(id: number): Promise<GroupPreferences | null> {
    try {
      const pref = await groupsApi.preferences(id)
      preferences.value = pref
      return pref
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        preferences.value = null
        return null
      }
      error.value = e instanceof Error ? e.message : 'Failed to load preferences.'
      throw e
    }
  }

  async function upsertPreferences(id: number, payload: { preferred_llm_config_id: number | null }): Promise<GroupPreferences> {
    saving.value = true
    error.value = null
    try {
      preferences.value = await groupsApi.upsertPreferences(id, payload)
      return preferences.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save preferences.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function fetchTools(id: number): Promise<ToolSetting[]> {
    toolSettings.value = await groupsApi.tools(id)
    return toolSettings.value
  }

  async function upsertTool(id: number, toolClass: string, settings: Record<string, string>): Promise<ToolSetting> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.upsertTool(id, toolClass, settings)
      const idx = toolSettings.value.findIndex((t) => t.tool_class === toolClass)
      if (idx === -1) {
        toolSettings.value = [...toolSettings.value, updated]
      } else {
        toolSettings.value = toolSettings.value.map((t, i) => (i === idx ? updated : t))
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save tool settings.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function deleteTool(id: number, toolClass: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await groupsApi.deleteTool(id, toolClass)
      toolSettings.value = toolSettings.value.filter((t) => t.tool_class !== toolClass)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete tool settings.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function fetchLlmConfigs(id: number): Promise<Array<Record<string, unknown>>> {
    llmConfigs.value = await groupsApi.llmConfigs(id)
    return llmConfigs.value
  }

  async function createLlmConfig(id: number, payload: GroupLlmConfigPayload): Promise<Record<string, unknown>> {
    saving.value = true
    error.value = null
    try {
      const created = await groupsApi.createLlmConfig(id, payload)
      llmConfigs.value = [...llmConfigs.value, created]
      return created
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create LLM configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function updateLlmConfig(id: number, configId: number, payload: GroupLlmConfigUpdatePayload): Promise<Record<string, unknown>> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.updateLlmConfig(id, configId, payload)
      llmConfigs.value = llmConfigs.value.map((c) => (Number(c.id) === configId ? updated : c))
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update LLM configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function deleteLlmConfig(id: number, configId: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await groupsApi.deleteLlmConfig(id, configId)
      llmConfigs.value = llmConfigs.value.filter((c) => Number(c.id) !== configId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete LLM configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function setDefaultLlmConfig(id: number, configId: number): Promise<Record<string, unknown>> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.setDefaultLlmConfig(id, configId)
      llmConfigs.value = llmConfigs.value.map((c) =>
        Number(c.id) === configId ? updated : { ...c, is_default: false },
      )
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to set default LLM.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function updateGroup(id: number, payload: { name?: string; description?: string }): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.update(id, payload)
      if (group.value?.id === id) {
        group.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function deleteGroup(id: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await groupsApi.remove(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  function isLoadedFor(id: number): boolean {
    return loadedId === id && group.value !== null
  }

  function reset(): void {
    group.value = null
    members.value = []
    agents.value = []
    preferences.value = null
    toolSettings.value = []
    llmConfigs.value = []
    error.value = null
    loadedId = null
  }

  return {
    group,
    loading,
    saving,
    error,
    members,
    agents,
    preferences,
    toolSettings,
    llmConfigs,
    setLoaded,
    isLoadedFor,
    fetchDetail,
    fetchMembers,
    fetchAgents,
    fetchPreferences,
    upsertPreferences,
    fetchTools,
    upsertTool,
    deleteTool,
    fetchLlmConfigs,
    createLlmConfig,
    updateLlmConfig,
    deleteLlmConfig,
    setDefaultLlmConfig,
    updateGroup,
    deleteGroup,
    reset,
  }
})
