/**
 * speechProviderConfigs store — speech-to-text provider configurations.
 *
 * The cache is keyed by **principal slot** so a list visit for one
 * principal never bleeds into a list visit for another. The
 * `GET /api/v1/speech/provider-configs` endpoint already narrows by
 * `agent_id` (user/group principal of the named agent) or `group_id`
 * (one group) — the slot key pins that narrowing on the client so
 * `getSlot(agentId)` and `getSlot(groupId)` return distinct lists.
 *
 * Slot keys:
 *   - `'user'` (string sentinel) — unscoped caller view used by
 *     `/settings/speech`. The endpoint is hit with no query string.
 *   - `number` — a principal id. With `agentId` passed to
 *     `loadConfigsFor`, the call hits `?agent_id=N` (agent page slot);
 *     without it, the call hits `?group_id=N` (group page slot). The
 *     same numeric key can therefore be either, disambiguated by the
 *     caller at the call site.
 *
 * Each slot owns its `configs`, `preferredSpeech`, `loadingConfigs`,
 * `loadingPreference`, and `loaded` flag. `loaded` replaces the
 * previous global `initialized` boolean so a failure in one slot does
 * not freeze the others. `providers`, `loadingProviders`, `saving`,
 * and the unscoped `error` stay global — the provider schema is the
 * same across all principals, and the unscoped error surfaces
 * mutation failures (upsert/update/setDefault/setPreferred/remove)
 * via the page-level AlertBanner.
 *
 * Mutations (upsert / update / remove / setDefault / setPreferred) do
 * NOT touch the slot cache. The page-level caller refreshes the slot
 * it owns in its `onSaved` / `onDeleted` handler — the same contract
 * the previous `remove` followed, generalized. Mirroring the page's
 * existing `loadConfigs()` call avoids the microtask race in
 * vue-router 5.x where mutating the cache inside the action would
 * unmount the form mid-`emit('saved')`.
 *
 * Callers write the user's preferred config back via
 * `setPreferredSlot(key, value)` so the slot mirrors the persisted
 * preference immediately, without `setPreferred` having to know
 * which slot to update.
 */
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { speechProviderConfigs, ApiError } from '@/api/client'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
  SpeechProviderScope,
  PreferredSpeech,
} from '@/types/speechProviderConfig'

/**
 * Discriminated union for the preferred-config scope the agent-settings
 * page loads. The store builds it from the agent's principal (user vs.
 * group) and uses it to pick the right
 * {@see SpeechProviderConfigService::getPreference} call.
 */
type PreferredScope =
  | { kind: 'user' }
  | { kind: 'group'; groupId: number }

const USER_SCOPE: PreferredScope = { kind: 'user' }

/**
 * `'user'` covers the unscoped caller-slot used by `/settings/speech`;
 * a numeric key covers both the agent page slot (`?agent_id=N`) and
 * the group page slot (`?group_id=N`) — disambiguated by the second
 * argument to `loadConfigsFor`.
 */
export type SlotKey = number | 'user'

interface PrincipalSlot {
  configs: SpeechProviderConfig[]
  preferredSpeech: PreferredSpeech | null
  loadingConfigs: boolean
  loadingPreference: boolean
  loaded: boolean
  error: string | null
}

function createSlot(): PrincipalSlot {
  return reactive<PrincipalSlot>({
    configs: [],
    preferredSpeech: null,
    loadingConfigs: false,
    loadingPreference: false,
    loaded: false,
    error: null,
  })
}

export const useSpeechProviderConfigsStore = defineStore('speechProviderConfigs', () => {
  const slots = reactive(new Map<SlotKey, PrincipalSlot>())
  const providers = ref<SpeechProviderClassSchema[]>([])
  const loadingProviders = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  // Read-side helper: returns the slot for `key`, creating an empty one
  // on first read so consumers can always dereference `slot.configs`
  // without a `?.` chain. Callers must not assume the slot is loaded —
  // check `slot.loaded` (or just render the empty list while it fills).
  function getSlot(key: SlotKey): PrincipalSlot {
    let slot = slots.get(key)
    if (!slot) {
      slot = createSlot()
      slots.set(key, slot)
    }
    return slot
  }

  // Same shape as `getSlot` — kept as a separate name so read paths
  // and write paths are easy to grep for, and so a future refactor can
  // diverge the two without renaming the call sites.
  function ensureSlot(key: SlotKey): PrincipalSlot {
    return getSlot(key)
  }

  /**
   * Populate the named slot's `configs`. The endpoint is selected by
   * key + the optional `agentId`:
   *   - `'user'`  → `GET /speech/provider-configs` (no query)
   *   - number, agentId supplied  → `GET /speech/provider-configs?agent_id=N`
   *   - number, no agentId  → `GET /speech/provider-configs?group_id=N`
   *
   * Caller-driven refresh: mutations do NOT touch the cache, so pages
   * re-call this after a save to mirror the canonical server list.
   */
  async function loadConfigsFor(key: SlotKey, agentId?: number): Promise<void> {
    const slot = ensureSlot(key)
    slot.loadingConfigs = true
    slot.error = null
    try {
      let result: { configs: SpeechProviderConfig[] }
      if (typeof key === 'string') {
        result = await speechProviderConfigs.list()
      } else if (agentId !== undefined) {
        result = await speechProviderConfigs.list(agentId)
      } else {
        result = await speechProviderConfigs.listForGroup(key)
      }
      slot.configs = result.configs
      slot.loaded = true
    } catch (e) {
      slot.error = e instanceof ApiError ? e.message : 'Failed to load speech provider configurations.'
      slot.loaded = false
    } finally {
      slot.loadingConfigs = false
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

  /**
   * Hydrate the named slot's `preferredSpeech` from
   * `GET /api/v1/speech/preference`. 404 means "no preference yet" —
   * `slot.preferredSpeech` becomes `null` and no error is surfaced.
   * Other failures leave `slot.preferredSpeech` null and write the
   * message into `slot.error` so the page can react.
   *
   * `scope` + optional `groupId` pick the right preference row —
   * `user` for user-owned agents, `group` with the group's id for
   * group-owned agents. The agent-settings page decides which based
   * on the agent's principal.
   */
  async function loadPreferenceFor(
    key: SlotKey,
    scope: 'user' | 'group',
    groupId?: number,
  ): Promise<void> {
    const slot = ensureSlot(key)
    slot.loadingPreference = true
    try {
      const result = await speechProviderConfigs.getPreference(
        scope,
        groupId,
      )
      slot.preferredSpeech = result.preference
    } catch (e) {
      slot.preferredSpeech = null
      if (e instanceof ApiError && e.status === 404) {
        return
      }
      slot.error = e instanceof ApiError ? e.message : 'Failed to load speech preference.'
    } finally {
      slot.loadingPreference = false
    }
  }

  /**
   * Idempotent per-slot loader: if `slots.get(key)?.loaded === true`,
   * return immediately. Otherwise run the configs fetch, the schema
   * fetch (only when no providers are cached yet), and the preference
   * fetch in parallel, then mark the slot loaded.
   *
   * On any failure the slot's `loaded` flag stays false so a
   * subsequent `ensure(key)` re-tries. The global `initialized`
   * boolean from the previous revision is gone — the per-slot flag
   * replaces it without the cross-slot freeze.
   */
  async function ensure(
    key: SlotKey,
    agentId?: number,
    preferredScope: PreferredScope = USER_SCOPE,
  ): Promise<void> {
    const existing = slots.get(key)
    if (existing?.loaded === true) return

    const tasks: Promise<unknown>[] = [
      loadConfigsFor(key, agentId),
      loadPreferenceFor(
        key,
        preferredScope.kind,
        preferredScope.kind === 'group' ? preferredScope.groupId : undefined,
      ),
    ]
    if (providers.value.length === 0) {
      tasks.push(loadProviders())
    }
    await Promise.all(tasks)

    if (slots.get(key)?.error === null) {
      ensureSlot(key).loaded = true
    } else {
      ensureSlot(key).loaded = false
    }
  }

  /**
   * Create or update a config row via POST. Returns the new config.
   * Does NOT touch the cache — the page-level caller refreshes the
   * slot it owns in its `onSaved` handler. Doing the refresh here
   * would mutate the slot mid-`emit('saved')` and race the form
   * unmount in vue-router 5.x (the same microtask ordering the
   * `remove` contract was designed around).
   */
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
      return result.config
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to save speech provider configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Update a config row via PUT. Returns the updated config. Does NOT
   * touch the cache — caller refreshes its slot in `onSaved`.
   */
  async function update(
    id: number,
    payload: { display_name?: string; settings?: Record<string, string> },
  ): Promise<SpeechProviderConfig> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.update(id, payload)
      return result.config
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to update speech provider configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Delete a config row by id. ONLY performs the DELETE call — the
   * caller refreshes its slot in `onDeleted`. Mirroring the page's
   * `loadConfigsFor(key)` call avoids the same vue-router 5.x microtask
   * race the original `remove` documented: the edit form would unmount
   * before its `emit('deleted')` listener fires if the cache mutated
   * inside the action.
   */
  async function remove(id: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await speechProviderConfigs.delete(id)
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to delete speech provider configuration.'
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Promote a config row to the default for its scope. Returns the
   * freshly-flagged row. The backend atomically clears `is_default`
   * on every other row at that scope; the caller refreshes its slot
   * to see the canonical list (the badge in the list view keys off
   * `is_default`).
   */
  async function setDefault(configId: number): Promise<SpeechProviderConfig> {
    saving.value = true
    error.value = null
    try {
      const result = await speechProviderConfigs.setDefault(configId)
      return result.config
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to set default speech provider.'
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Save the caller's preferred STT provider class. Returns the
   * updated envelope — the caller writes it into the named slot via
   * `setPreferredSlot(key, value)` so the UI mirrors it immediately.
   * The endpoint is outside the `/provider-configs` envelope and does
   * NOT mutate any slot's `configs` array.
   */
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

  /**
   * Mirror a server-returned preference into the named slot. The page
   * calls this in the `setPreferred()` success branch so the dropdown
   * flips to the operator's choice without waiting for a full slot
   * reload.
   */
  function setPreferredSlot(key: SlotKey, value: PreferredSpeech | null): void {
    ensureSlot(key).preferredSpeech = value
  }

  function providerByClass(className: string): SpeechProviderClassSchema | undefined {
    return providers.value.find((p) => p.class === className)
  }

  return {
    providers,
    loadingProviders,
    saving,
    error,
    getSlot,
    setPreferredSlot,
    loadConfigsFor,
    loadProviders,
    loadPreferenceFor,
    ensure,
    upsert,
    update,
    remove,
    setDefault,
    setPreferred,
    providerByClass,
  }
})
