/**
 * groupDetail store — fetches and mutates one group's resources.
 *
 * Reset on dialog close (i.e. when navigating away from the group) so stale
 * counts and members don't leak across groups. The detail page calls `reset()`
 * from `onUnmounted`; the per-resource fetchers are idempotent so navigating
 * between sub-pages is cheap.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { groupsApi, type ToolSetting, type GroupLlmConfigPayload, type GroupLlmConfigUpdatePayload, type GroupPreferences } from '@/api/groups'
import { ApiError } from '@/api/client'
import { i18n } from '@/i18n'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'
import { applyLocationChanges, type LocationChange } from '@/composables/useLocations'
import type { Group, GroupMember } from '@/types/principal'
import type { Location, LocationPayload } from '@/types/location'

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
  const locations = ref<Location[]>([])
  const locationsLoading = ref(false)
  const locationsError = ref<string | null>(null)

  let loadedId: number | null = null

  // The group the cached list belongs to. The layout resets the store when
  // the route changes to another group, but a write that is still on the
  // wire resolves after that — the id is what tells a late write that it
  // no longer owns the cache.
  let locationsGroupId: number | null = null

  // The changes the writes made, applied over a list that arrives later.
  // The server's list is the truth for everything the client did not
  // change itself. The newest load consumes them — an older load that
  // resolves later must not write the cache.
  let locationChanges: LocationChange[] = []

  // The rows a delete removed. A write that was on the wire when the
  // delete landed must not bring them back: the server applied the
  // writes in the order the client dispatched them, and the delete was
  // dispatched last.
  const deletedLocations = new Set<number>()

  // The newest load owns the cache. An older one that resolves later
  // carries the older list and must not overwrite it.
  let locationsLoadSeq = 0

  async function fetchDetail(id: number): Promise<Group> {
    loading.value = true
    error.value = null
    try {
      const detail = await groupsApi.get(id)
      group.value = detail
      loadedId = id
      return detail
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to load group.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to load preferences.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to save preferences.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to save tool settings.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to delete tool settings.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to create LLM configuration.')
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
      // The model's level set and the config's default are what the effort
      // endpoint answers with, so every agent that runs on this
      // configuration has to ask again.
      clearAgentEffortCache()
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to update LLM configuration.')
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
      // An agent that named this configuration falls back to the next tier
      // of the cascade, so its cached effort capability is no longer the
      // truth.
      clearAgentEffortCache()
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to delete LLM configuration.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to set default LLM.')
      throw e
    } finally {
      saving.value = false
    }
  }

  async function updateGroup(id: number, payload: { name?: string; description?: string; information?: string | null }): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.update(id, payload)
      if (group.value?.id === id) {
        group.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to update group.')
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
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to delete group.')
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Apply a write to the cached list — but only while the cache is still
   * the group's the write belongs to. A write that resolves after the
   * layout moved on to another group must not land in that group's list.
   */
  function applyLocationChange(id: number, change: LocationChange): void {
    if (locationsGroupId !== id) return
    locationChanges.push(change)
    locations.value = applyLocationChanges(locations.value, [change])
  }

  /**
   * The location error belongs to the group whose section renders it, so a
   * write that lands after the layout moved on leaves that section alone.
   */
  function setLocationError(id: number, message: string | null): void {
    if (locationsGroupId === id) {
      locationsError.value = message
    }
  }

  /**
   * The group's saved addresses. The failure is recorded in
   * `locationsError` rather than the store-wide `error`, because the
   * locations are their own section — a location failure must not read as
   * a failure of the group itself.
   *
   * Returns the list the caller asked for, even when the cache has moved on
   * to another group by the time the request comes back.
   */
  async function fetchLocations(id: number): Promise<Location[]> {
    if (locationsGroupId !== id) {
      // The cache belongs to another group; its pending changes do not
      // carry over to this one.
      locationChanges = []
      deletedLocations.clear()
    }
    locationsLoading.value = true
    locationsError.value = null
    locationsGroupId = id
    const seq = ++locationsLoadSeq
    try {
      const list = await groupsApi.listLocations(id)
      if (locationsGroupId !== id || seq !== locationsLoadSeq) return list
      locations.value = applyLocationChanges(list, locationChanges)
      locationChanges = []
      return locations.value
    } catch (e) {
      if (locationsGroupId === id && seq === locationsLoadSeq) {
        locationsError.value = e instanceof Error ? e.message : i18n.global.t('Failed to load locations.')
      }
      throw e
    } finally {
      if (locationsGroupId === id && seq === locationsLoadSeq) {
        locationsLoading.value = false
      }
    }
  }

  async function createLocation(id: number, payload: LocationPayload): Promise<Location> {
    setLocationError(id, null)
    try {
      const created = await groupsApi.createLocation(id, payload)
      applyLocationChange(id, { kind: 'upsert', row: created })
      return created
    } catch (e) {
      setLocationError(id, e instanceof Error ? e.message : i18n.global.t('Failed to save location.'))
      throw e
    }
  }

  async function updateLocation(id: number, locationId: number, payload: LocationPayload): Promise<Location> {
    setLocationError(id, null)
    try {
      const updated = await groupsApi.updateLocation(id, locationId, payload)
      // A delete that landed in the meantime wins: the server applied the
      // writes in the order the client dispatched them.
      if (!deletedLocations.has(locationId)) {
        applyLocationChange(id, { kind: 'upsert', row: updated })
      }
      return updated
    } catch (e) {
      setLocationError(id, e instanceof Error ? e.message : i18n.global.t('Failed to save location.'))
      throw e
    }
  }

  async function deleteLocation(id: number, locationId: number): Promise<void> {
    setLocationError(id, null)
    try {
      await groupsApi.deleteLocation(id, locationId)
      if (locationsGroupId === id) {
        deletedLocations.add(locationId)
      }
      applyLocationChange(id, { kind: 'delete', id: locationId })
    } catch (e) {
      setLocationError(id, e instanceof Error ? e.message : i18n.global.t('Failed to delete location.'))
      throw e
    }
  }

  /**
   * PATCH the group's profile picture metadata (archetype /
   * variant_key / palette_key). The wire shape flows through the same
   * `profile_picture` nested object as agents — see
   * `AgentProfilePictureSection.vue`.
   */
  async function updateProfilePicture(
    id: number,
    patch: { archetype?: string | null; variant_key?: string | null; palette_key?: string | null },
  ): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.patchProfilePicture(id, patch)
      if (group.value?.id === id) {
        group.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to update picture.')
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Upload a new picture image (multipart). 1 MiB cap, PNG/JPEG/WebP.
   */
  async function uploadProfilePictureImage(id: number, file: File): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.uploadProfilePictureImage(id, file)
      if (group.value?.id === id) {
        group.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to upload picture.')
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Detach the uploaded picture image. The group reverts to its
   * archetype avatar (or the default if no archetype was ever picked).
   */
  async function deleteProfilePictureImage(id: number): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const updated = await groupsApi.removeProfilePictureImage(id)
      if (group.value?.id === id) {
        group.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : i18n.global.t('Failed to remove picture.')
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
    locations.value = []
    locationsLoading.value = false
    locationsError.value = null
    error.value = null
    loadedId = null
    locationsGroupId = null
    locationChanges = []
    deletedLocations.clear()
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
    locations,
    locationsLoading,
    locationsError,
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
    fetchLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    updateProfilePicture,
    uploadProfilePictureImage,
    deleteProfilePictureImage,
    reset,
  }
})
