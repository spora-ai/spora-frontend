/**
 * useGlobalSettingsStore — two admin-facing surfaces that share one store.
 *
 * 1. The runtime settings registry (`GET`/`PATCH`/`DELETE /admin/settings`),
 *    rendered by `pages/admin/runtime/`. The registry is the authoritative list
 *    of Spora's `SPORA_*` keys with their type, default, precedence layer and
 *    whether the value is a boot-time secret, so the pages never hardcode a key
 *    name or a form control. It also holds the draft, which lives here rather
 *    than in a page because the settings are split across five routes.
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
import { computed, ref } from 'vue'
import { api, ApiError } from '@/api/client'
import { useToolSettings } from '@/composables/useToolSettings'
import type { ToolSchema } from '@/composables/useToolSettings'
import { draftValue, pageForSection, toWireValue } from '@/lib/runtimeSettings'
import type { Draft, RuntimePageKey } from '@/lib/runtimeSettings'
import type {
  GlobalSetting,
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

  /**
   * The draft lives here rather than in a page component because the settings
   * are split across routes: a component-held draft would be destroyed on
   * navigation, and an operator who edited mail, clicked to media and came back
   * would find their changes gone. `baseline` is the seeded copy the diff is
   * taken against — comparing the draft to the store's own sections instead
   * would report a change for every field the moment a secret were re-masked.
   */
  const draft = ref<Draft>({})
  const baseline = ref<Draft>({})

  /**
   * Rebuild the draft from a fresh payload.
   *
   * `preservePending` exists for the reset path. A reset has to re-read the
   * server, because the response names the key but not the layer it fell back
   * to — a reset can expose a `.env` value this client never saw. That re-read
   * would otherwise wipe edits in progress on the other pages, so the pending
   * updates are laid back over the fresh values. Saving passes `false`, because
   * there the pending updates have just been written and the point is to clear
   * them.
   */
  function seedDraft(payload: GlobalSettingSection[], preservePending = false): void {
    const fresh: Draft = {}
    for (const section of payload) {
      fresh[section.key] = {}
      for (const setting of section.settings) {
        fresh[section.key][setting.key] = draftValue(setting)
      }
    }

    const next: Draft = preservePending
      ? (JSON.parse(JSON.stringify(fresh)) as Draft)
      : fresh

    if (preservePending) {
      for (const section of payload) {
        for (const update of pendingBySection.value[section.key] ?? []) {
          const setting = section.settings.find((s) => s.key === update.key)
          if (setting) next[section.key][update.key] = draftValue(setting, update.value)
        }
      }
    }

    draft.value = next
    // The baseline is what the server said, not the overlay — putting the
    // in-flight edits on both sides makes the diff empty and silently reports
    // the page as clean, which is the one thing the dot in the sub-navigation
    // exists to prevent.
    baseline.value = fresh
  }

  function setDraftValue(sectionKey: string, setting: GlobalSetting, value: unknown): void {
    if (!draft.value[sectionKey]) draft.value[sectionKey] = {}
    draft.value[sectionKey][setting.key] = typeof value === 'boolean' ? value : String(value ?? '')
  }

  /**
   * What each section would send, keyed by section. Split per section because
   * that is the unit the pages are built from: the sub-navigation marks the
   * pages with pending work from this, and a page's Save sends only its own.
   */
  const pendingBySection = computed<Record<string, GlobalSettingUpdate[]>>(() => {
    const out: Record<string, GlobalSettingUpdate[]> = {}
    for (const section of sections.value) {
      const updates: GlobalSettingUpdate[] = []
      for (const setting of section.settings) {
        const current = draft.value[section.key]?.[setting.key]
        if (current === undefined || current === baseline.value[section.key]?.[setting.key]) continue
        const value = toWireValue(setting, current)
        if (value === undefined) continue
        updates.push({ group: setting.group, key: setting.key, value })
      }
      if (updates.length > 0) out[section.key] = updates
    }
    return out
  })

  const pendingCount = computed(() =>
    Object.values(pendingBySection.value).reduce((total, list) => total + list.length, 0),
  )

  /** Pages with unsaved work, so the sub-navigation can mark them. */
  const dirtyPageKeys = computed<RuntimePageKey[]>(() => {
    const dirty = new Set<RuntimePageKey>()
    for (const section of sections.value) {
      if (pendingBySection.value[section.key] === undefined) continue
      dirty.add(pageForSection(section.key))
    }
    return [...dirty]
  })

  function isPageDirty(pageKey: RuntimePageKey): boolean {
    return dirtyPageKeys.value.includes(pageKey)
  }

  /** Everything pending across all pages, for a navigation-guard prompt. */
  const allPending = computed<GlobalSettingUpdate[]>(() => Object.values(pendingBySection.value).flat())

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
      // Seeded here rather than from a watcher in the page: the draft belongs to
      // the store, and a page that seeds it is a page that has to remember to.
      seedDraft(sections.value, true)
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
    draft,
    baseline,
    seedDraft,
    setDraftValue,
    pendingBySection,
    pendingCount,
    dirtyPageKeys,
    isPageDirty,
    allPending,
    allTools,
    toolSettings,
    loadingTools,
    toolError,
    loadTools,
    loadToolSettings,
  }
})