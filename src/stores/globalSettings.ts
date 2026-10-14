/**
 * useGlobalSettingsStore — two admin-facing surfaces that share one store.
 *
 * 1. The runtime settings registry (`GET`/`PATCH`/`DELETE /admin/settings`),
 *    rendered by `pages/admin/runtime/`. The registry is the authoritative list
 *    of Spora's `SPORA_*` keys with their type, default, precedence layer and
 *    whether the value is a boot-time secret, so the pages never hardcode a key
 *    name or a form control. This store holds the registry and nothing about
 *    an edit in progress — that belongs to the overlay, which is open or shut.
 *
 * 2. The global tool defaults (`GET /tools`, `PUT /tools/{id}/settings`),
 *    still rendered by `pages/admin/ToolsSettingsPage.vue`.
 *
 * `save()` is write-through: a successful PATCH returns the keys it accepted
 * and nothing else — no values — so the store applies the one fact it is
 * told (these keys now live in the database) rather than assuming the value
 * it sent is byte-identical to what the server stored. The caller re-seeds
 * its form from the mutated sections.
 *
 * A setting whose value is a secret crosses the wire as the literal `'***'`.
 * Two rules follow from that and are enforced where the payload is built:
 * an untouched `'***'` is omitted (the server would otherwise store three
 * asterisks as the password), and a cleared one is sent as `''` — that is
 * the only way a secret gets cleared.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, ApiError } from '@/api/client'
import { useToolSettings } from '@/composables/useToolSettings'
import type { ToolSchema } from '@/composables/useToolSettings'
import type {
  GlobalSettingSection,
  GlobalSettingUpdate,
  GlobalSettingsPayload,
} from '@/types/globalSettings'
import { useAuthStore } from '@/stores/auth'

/** The mask the server sends in place of a secret's real value. */
const SECRET_MASK = '***'

export const useGlobalSettingsStore = defineStore('globalSettings', () => {
  const sections = ref<GlobalSettingSection[]>([])
  const undecryptable = ref<string[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const allTools = ref<ToolSchema[]>([])
  const toolSettings = ref<Record<string, Record<string, string>>>({})
  const loadingTools = ref(false)
  const toolError = ref<string | null>(null)

  async function fetchSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await api.get<GlobalSettingsPayload>('/admin/settings')
      sections.value = result.sections ?? []
      undecryptable.value = result.undecryptable ?? []
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load global settings.'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function save(updates: GlobalSettingUpdate[]): Promise<string[]> {
    saving.value = true
    error.value = null
    try {
      const result = await api.patch<{ updated: string[] }>('/admin/settings', { settings: updates })
      const updated = result.updated ?? []
      applyWriteThrough(updated)
      return updated
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to save global settings.'
      throw e
    } finally {
      saving.value = false
    }
  }

  function applyWriteThrough(updatedKeys: string[]): void {
    const accepted = new Set(updatedKeys)
    for (const section of sections.value) {
      for (const setting of section.settings) {
        if (!accepted.has(setting.key)) continue
        // The row now exists, so the database is the top layer for this key.
        setting.source = 'database'
        setting.undecryptable = false
        // A secret is masked again on the way back, so the next render shows
        // the locked display rather than the literal the operator just typed.
        if (setting.secret) setting.value = SECRET_MASK
      }
    }
    undecryptable.value = undecryptable.value.filter((key) => !accepted.has(key))
  }

  async function resetSetting(group: string, key: string): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await api.delete<{ reset: string[] }>(
        `/admin/settings/${encodeURIComponent(group)}/${encodeURIComponent(key)}`,
      )
      // The response names the key but not the layer it fell back to, and a
      // reset can expose a `.env` or `config.php` value this page never saw.
      // Only a re-read knows, so refetch rather than guess.
      await fetchSettings()
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to reset the setting.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function loadTools(): Promise<void> {
    loadingTools.value = true
    toolError.value = null
    try {
      const auth = useAuthStore()
      if (!auth.initialized) {
        await auth.init()
      }
      const result = await api.get<{ tools: ToolSchema[] }>('/tools')
      allTools.value = result.tools ?? []
    } catch (e) {
      toolError.value = e instanceof ApiError ? e.message : 'Failed to load tools.'
    } finally {
      loadingTools.value = false
    }
  }

  async function loadToolSettings(): Promise<void> {
    // Ensure tools are loaded first (may be called before loadTools in parallel paths)
    if (allTools.value.length === 0) {
      await loadTools()
    }
    const toolSettingsApi = useToolSettings()
    await Promise.all(
      allTools.value
        .filter((t) => t.settings_schema.length > 0)
        .map(async (tool) => {
          try {
            const settings = await toolSettingsApi.getGlobalSettings(tool.tool_name)
            toolSettings.value[tool.tool_name] = settings
          } catch {
            toolSettings.value[tool.tool_name] = {}
          }
        }),
    )
  }

  return {
    sections,
    undecryptable,
    loading,
    saving,
    error,
    fetchSettings,
    save,
    resetSetting,
    allTools,
    toolSettings,
    loadingTools,
    toolError,
    loadTools,
    loadToolSettings,
  }
})