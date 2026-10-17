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
 * Every write is followed by a re-read rather than a local patch-up. A PATCH
 * returns the keys it accepted and no values, and reconstructing the value the
 * server stored from what was sent is wrong for everything it transforms — a
 * list is stored as JSON but shown as lines, a legacy spelling is stored
 * canonically — so the page could show something the server never agreed to
 * hold.
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
      await refresh()
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load global settings.'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-read without raising the loading flag, for use after a write.
   *
   * `loading` blanks the table, and a table that blanks itself every time a
   * setting is saved turns an ordinary edit into a page reload.
   *
   * The assignments come after the request, so a failure leaves what is already
   * on screen alone. `save()` catches that failure separately: the write did
   * succeed, and reporting it as a failed save would send the operator off to
   * retry something that is already stored.
   */
  async function refresh(): Promise<void> {
    const result = await api.get<GlobalSettingsPayload>('/admin/settings')
    sections.value = result.sections ?? []
    undecryptable.value = result.undecryptable ?? []
  }

  /**
   * A PATCH answers with the keys it accepted and nothing else — no values.
   * That used to be patched over locally: the accepted keys were marked
   * `database` and the value you had just sent written back in place of the one
   * on screen. It kept the two in step for plain values and quietly disagreed
   * for everything the server transforms — a list is stored as JSON but shown
   * as lines, and a legacy spelling is stored canonically — so a field could
   * show something the server never agreed to hold, which is exactly the
   * failure this screen exists to prevent.
   *
   * Re-reading is one request on an admin action, and it makes the page unable
   * to disagree with the server at all.
   */
  async function save(updates: GlobalSettingUpdate[]): Promise<string[]> {
    saving.value = true
    error.value = null
    try {
      const result = await api.patch<{ updated: string[] }>('/admin/settings', { settings: updates })
      try {
        await refresh()
      } catch {
        // The write landed. The screen keeps the values it already had and the
        // caller reports success — the next navigation will pick the change up.
      }
      return result.updated ?? []
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to save global settings.'
      throw e
    } finally {
      saving.value = false
    }
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
    refresh,
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