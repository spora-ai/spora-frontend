/**
 * speechProviderConfigs store — speech-to-text provider configurations.
 *
 * Mirrors the LLM configs store shape: list + ensure + CRUD mutations.
 * Three cached lists (personal / global / group) so the admin page,
 * user settings page, and group settings page can share one store
 * instance without re-fetching.
 *
 * The backend's `GET /speech/provider-configs` returns all three scopes
 * in a single envelope — admins see all global configs, callers see
 * their own user-scope overrides and any group-scope configs for groups
 * they belong to — and the getters slice that single array for whichever
 * view needs it. Cache invalidation is uniform: every mutation calls
 * `loadConfigs()` so the next read sees the server's truth.
 *
 * Per-group reads go through `loadForGroup(groupId)` which hits the
 * endpoint's `?group_id=N` filter so the Group settings page renders
 * exactly that group's configs even before the unscoped `loadConfigs()`
 * cache has them.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { speechProviderConfigs, ApiError } from '@/api/client'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
  SpeechProviderScope,
  PreferredSpeech,
} from '@/types/speechProviderConfig'

export const useSpeechProviderConfigsStore = defineStore('speechProviderConfigs', () => {
  const configs = ref<SpeechProviderConfig[]>([])
  const providers = ref<SpeechProviderClassSchema[]>([])
  const preferredSpeech = ref<PreferredSpeech | null>(null)
  const loadingConfigs = ref(false)
  const loadingProviders = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const initialized = ref(false)

  const personalConfigs = computed(() => configs.value.filter((c) => c.scope === 'user'))
  const globalConfigs = computed(() => configs.value.filter((c) => c.scope === 'global'))
  const groupConfigs = computed(() => configs.value.filter((c) => c.scope === 'group'))

  async function loadConfigs(): Promise<void> {
    loadingConfigs.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.list()
      configs.value = result.configs
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load speech provider configurations.'
    } finally {
      loadingConfigs.value = false
    }
  }

  async function loadForGroup(groupId: number): Promise<SpeechProviderConfig[]> {
    loadingConfigs.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.listForGroup(groupId)
      // Merge into the unscoped cache so group rows survive a refresh
      // triggered from elsewhere (admin / user pages) instead of being
      // silently dropped on the next loadConfigs().
      const existingById = new Map(configs.value.map((c) => [c.id, c]))
      for (const row of result.configs) {
        existingById.set(row.id, row)
      }
      configs.value = Array.from(existingById.values())
      return result.configs
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load group speech provider configurations.'
      error.value = msg
      throw e
    } finally {
      loadingConfigs.value = false
    }
  }

  async function loadProviders(): Promise<void> {
    loadingProviders.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.listSchema()
      providers.value = result.providers
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load speech provider schema.'
    } finally {
      loadingProviders.value = false
    }
  }

  // Hydrates `preferredSpeech` from `GET /api/v1/speech/preference`. 404
  // is a normal "no preference yet" state — leave `preferredSpeech` null
  // and don't surface it as an error. Other failures set the store error
  // so the user sees a meaningful message instead of a stale UI.
  async function loadPreference(): Promise<void> {
    try {
      const result = await speechProviderConfigs.getPreference('user')
      preferredSpeech.value = result.preference
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        preferredSpeech.value = null
        return
      }
      preferredSpeech.value = null
      error.value = e instanceof ApiError ? e.message : 'Failed to load speech preference.'
    }
  }

  async function ensure(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    await Promise.all([loadConfigs(), loadProviders(), loadPreference()])
  }

  async function upsert(payload: {
    provider_class: string
    scope: SpeechProviderScope
    display_name?: string
    settings: Record<string, string>
    group_id?: number
  }): Promise<SpeechProviderConfig> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.upsert(payload)
      // Refresh from the server so the cache mirrors the canonical list —
      // upserts can introduce new IDs (first-time creates) and the caller
      // already has the returned config, so the round-trip is cheap.
      await loadConfigs()
      return result.config
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save speech provider configuration.'
      error.value = msg
      throw e
    } finally {
      saving.value = false
    }
  }

  async function update(
    id: number,
    payload: { display_name?: string; settings?: Record<string, string> },
  ): Promise<SpeechProviderConfig> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.update(id, payload)
      await loadConfigs()
      return result.config
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to update speech provider configuration.'
      error.value = msg
      throw e
    } finally {
      saving.value = false
    }
  }

  async function remove(id: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await speechProviderConfigs.delete(id)
      await loadConfigs()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete speech provider configuration.'
      error.value = msg
      throw e
    } finally {
      saving.value = false
    }
  }

  // Promote a config row to the default for its scope. The backend
  // atomically clears `is_default` on every other row at that scope and
  // returns the freshly-flagged row; we refresh the cache so the next
  // read sees the canonical list (the badge in the list view keys off
  // `is_default`).
  async function setDefault(configId: number): Promise<SpeechProviderConfig> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.setDefault(configId)
      await loadConfigs()
      return result.config
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to set default speech provider.'
      throw e
    } finally {
      saving.value = false
    }
  }

  // Save the caller's preferred STT provider class. The endpoint is
  // outside the `/provider-configs` envelope — it does NOT mutate the
  // cached `configs` array. The caller updates `store.preferredSpeech`
  // with the returned value (UI mirrors it in the widget immediately).
  async function setPreferred(payload: {
    config_id: number | null
    scope: 'user' | 'group'
    group_id?: number
  }): Promise<PreferredSpeech> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.setPreferred(payload)
      return result.preference
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to save speech provider preference.'
      throw e
    } finally {
      saving.value = false
    }
  }

  function providerByClass(className: string): SpeechProviderClassSchema | undefined {
    return providers.value.find((p) => p.class === className)
  }

  return {
    configs,
    providers,
    preferredSpeech,
    loadingConfigs,
    loadingProviders,
    saving,
    error,
    initialized,
    personalConfigs,
    globalConfigs,
    groupConfigs,
    loadConfigs,
    loadForGroup,
    loadProviders,
    loadPreference,
    ensure,
    upsert,
    update,
    remove,
    setDefault,
    setPreferred,
    providerByClass,
  }
})
