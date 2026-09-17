import { setActivePinia, createPinia } from 'pinia'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  speechProviderConfigs: {
    list: vi.fn(),
    listForGroup: vi.fn(),
    listSchema: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setDefault: vi.fn(),
    getPreference: vi.fn(),
    setPreferred: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
}))

import { speechProviderConfigs, ApiError } from '@/api/client'

const mockNs = speechProviderConfigs as unknown as {
  list: ReturnType<typeof vi.fn>
  listForGroup: ReturnType<typeof vi.fn>
  listSchema: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  setDefault: ReturnType<typeof vi.fn>
  getPreference: ReturnType<typeof vi.fn>
  setPreferred: ReturnType<typeof vi.fn>
}

const openAiProvider = {
  class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
  display_name: 'OpenAI Compatible',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true, default: 'whisper-1' },
  ],
}

const museProvider = {
  class: 'Spora\\Plugins\\Muse\\MuseTranscribeProvider',
  display_name: 'Meta Muse Voice Transcribe',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
  ],
}

const globalConfig = {
  id: 7,
  provider_class: openAiProvider.class,
  provider_display_name: openAiProvider.display_name,
  scope: 'global' as const,
  display_name: 'Mistral Voxtral (prod)',
  settings: { api_key: '***', model: 'voxtral-mini-latest' },
  is_default: true,
  created_at: '2026-09-11T12:34:56Z',
  updated_at: '2026-09-11T12:34:56Z',
}

const userConfig = {
  ...globalConfig,
  id: 12,
  scope: 'user' as const,
  display_name: 'Personal Mistral',
  is_default: false,
}

describe('useSpeechProviderConfigsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    // Default: 404 on getPreference so loadPreferenceFor leaves the
    // slot's `preferredSpeech` as null without surfacing an error.
    // Individual tests override this when they want a hydrated preference.
    mockNs.getPreference.mockRejectedValue(new ApiError('Not Found', 'NOT_FOUND', 404))
  })

  describe('loadConfigsFor', () => {
    it("fetches configs and stores them under the 'user' slot", async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig, userConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigsFor('user')

      expect(mockNs.list).toHaveBeenCalledTimes(1)
      expect(mockNs.list).toHaveBeenCalledWith()
      const slot = store.getSlot('user')
      expect(slot.configs).toEqual([globalConfig, userConfig])
      expect(slot.loaded).toBe(true)
      expect(slot.loadingConfigs).toBe(false)
    })

    it('forwards agentId to the API when key is a number (agent page slot)', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigsFor(42, 42)

      expect(mockNs.list).toHaveBeenCalledWith(42)
      expect(store.getSlot(42).configs).toEqual([globalConfig])
    })

    it('forwards group_id to the API when key is a number and agentId is omitted (group page slot)', async () => {
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [{ ...globalConfig, id: 50, scope: 'group' as const, display_name: 'Team Whisper' }] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigsFor(7)

      expect(mockNs.listForGroup).toHaveBeenCalledWith(7)
      expect(store.getSlot(7).configs).toHaveLength(1)
      expect(store.getSlot(7).configs[0].scope).toBe('group')
    })

    it('stores the error message on the slot on a 4xx failure and leaves loaded false', async () => {
      mockNs.list.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigsFor('user')

      const slot = store.getSlot('user')
      expect(slot.error).toBe('Forbidden')
      expect(slot.loadingConfigs).toBe(false)
      expect(slot.loaded).toBe(false)
    })

    it('uses a generic message when the rejection is not an ApiError', async () => {
      mockNs.list.mockRejectedValueOnce(new Error('network died'))

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigsFor('user')

      expect(store.getSlot('user').error).toBe('Failed to load speech provider configurations.')
    })
  })

  describe('loadProviders', () => {
    it('fetches the schema and stores it', async () => {
      mockNs.listSchema.mockResolvedValueOnce({ providers: [openAiProvider, museProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.loadProviders()

      expect(store.providers).toEqual([openAiProvider, museProvider])
      expect(store.loadingProviders).toBe(false)
    })
  })

  describe('ensure', () => {
    it('loads configs and providers on first call into the named slot', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValueOnce({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure(42, 42, { kind: 'user' })

      const slot = store.getSlot(42)
      expect(slot.configs).toEqual([globalConfig])
      expect(slot.loaded).toBe(true)
      expect(store.providers).toEqual([openAiProvider])
    })

    it('is idempotent for the same key — a second ensure(42) does not refetch', async () => {
      mockNs.list.mockResolvedValue({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValue({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure(42, 42)
      await store.ensure(42, 42)

      expect(mockNs.list).toHaveBeenCalledTimes(1)
      expect(mockNs.listSchema).toHaveBeenCalledTimes(1)
    })

    it('fetches again when the key changes — ensure(99) after ensure(42) triggers a second fetch', async () => {
      mockNs.list.mockResolvedValue({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValue({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure(42, 42)
      await store.ensure(99, 99)

      expect(mockNs.list).toHaveBeenCalledTimes(2)
      expect(mockNs.list.mock.calls[0][0]).toBe(42)
      expect(mockNs.list.mock.calls[1][0]).toBe(99)
    })

    it('keeps the named slot loaded=false on failure so retries are possible', async () => {
      mockNs.list.mockRejectedValue(new ApiError('Server error', 'UNKNOWN', 500))
      mockNs.listSchema.mockRejectedValue(new ApiError('Server error', 'UNKNOWN', 500))

      const store = useSpeechProviderConfigsStore()
      await store.ensure(42, 42)

      expect(store.getSlot(42).loaded).toBe(false)
      expect(store.getSlot(42).error).toBeTruthy()
    })

    it('hydrates preferredSpeech on the named slot when GET /preference returns a row', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [] })
      mockNs.listSchema.mockResolvedValueOnce({ providers: [] })
      mockNs.getPreference.mockResolvedValueOnce({
        preference: {
          config_id: userConfig.id,
          scope: 'user',
          group_id: null,
        },
      })

      const store = useSpeechProviderConfigsStore()
      await store.ensure(42, 42, { kind: 'user' })

      expect(store.getSlot(42).preferredSpeech).toEqual({
        config_id: userConfig.id,
        scope: 'user',
        group_id: null,
      })
    })

    it('switches slots when the key changes — calling ensure with a different agentId triggers a refetch', async () => {
      mockNs.list.mockResolvedValue({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValue({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure(1, 1)
      await store.ensure(2, 2)

      expect(mockNs.list).toHaveBeenCalledTimes(2)
      expect(store.getSlot(1).loaded).toBe(true)
      expect(store.getSlot(2).loaded).toBe(true)
      // The two slots remain independent — both hold the same configs
      // (the mock returns the same payload) but each was fetched
      // against its own key.
      expect(mockNs.list.mock.calls[0][0]).toBe(1)
      expect(mockNs.list.mock.calls[1][0]).toBe(2)
    })
  })

  describe('loadPreferenceFor', () => {
    it('sets preferredSpeech on the named slot from the envelope', async () => {
      mockNs.getPreference.mockResolvedValueOnce({
        preference: { config_id: userConfig.id, scope: 'user', group_id: null },
      })

      const store = useSpeechProviderConfigsStore()
      await store.loadPreferenceFor('user', 'user')

      expect(store.getSlot('user').preferredSpeech?.config_id).toBe(userConfig.id)
      expect(store.error).toBeNull()
    })

    it('treats 404 as "no preference yet" without surfacing an error', async () => {
      mockNs.getPreference.mockRejectedValueOnce(new ApiError('Not Found', 'NOT_FOUND', 404))

      const store = useSpeechProviderConfigsStore()
      await store.loadPreferenceFor('user', 'user')

      expect(store.getSlot('user').preferredSpeech).toBeNull()
      expect(store.error).toBeNull()
    })

    it('surfaces non-404 ApiError on the named slot', async () => {
      mockNs.getPreference.mockRejectedValueOnce(new ApiError('Server error', 'UNKNOWN', 500))

      const store = useSpeechProviderConfigsStore()
      await store.loadPreferenceFor('user', 'user')

      expect(store.getSlot('user').preferredSpeech).toBeNull()
      expect(store.getSlot('user').error).toBe('Server error')
    })
  })

  describe('upsert', () => {
    it('posts to the namespace and does NOT mutate any slot cache', async () => {
      const created = { ...globalConfig, id: 99, display_name: 'New' }
      mockNs.upsert.mockResolvedValueOnce({ config: created })

      const store = useSpeechProviderConfigsStore()
      // Seed two slots with distinct rows so the assertion is observable.
      store.getSlot('user').configs = [userConfig]
      store.getSlot(42).configs = [globalConfig]

      const result = await store.upsert({
        provider_class: openAiProvider.class,
        scope: 'global',
        settings: { api_key: 'sk-new', model: 'whisper-1' },
      })

      expect(mockNs.upsert).toHaveBeenCalledWith({
        provider_class: openAiProvider.class,
        scope: 'global',
        settings: { api_key: 'sk-new', model: 'whisper-1' },
      })
      expect(result).toEqual(created)
      // Caller-driven refresh contract — the mutation does NOT touch
      // the cache. The page-level caller refreshes its slot in
      // onSaved. This avoids the vue-router 5.x microtask race where
      // a mid-`emit('saved')` cache mutation unmounts the form.
      expect(store.getSlot('user').configs).toEqual([userConfig])
      expect(store.getSlot(42).configs).toEqual([globalConfig])
    })

    it('forwards display_name on the payload when the form provided one', async () => {
      const created = { ...globalConfig, id: 99, display_name: 'Mistral Voxtral (prod)' }
      mockNs.upsert.mockResolvedValueOnce({ config: created })

      const store = useSpeechProviderConfigsStore()
      await store.upsert({
        provider_class: openAiProvider.class,
        scope: 'global',
        display_name: 'Mistral Voxtral (prod)',
        settings: { api_key: 'sk-new', model: 'whisper-1', display_name: 'Mistral Voxtral (prod)' },
      })

      expect(mockNs.upsert).toHaveBeenCalledWith({
        provider_class: openAiProvider.class,
        scope: 'global',
        display_name: 'Mistral Voxtral (prod)',
        settings: { api_key: 'sk-new', model: 'whisper-1', display_name: 'Mistral Voxtral (prod)' },
      })
    })

    it('forwards group_id on the payload when scope is group', async () => {
      const created = { ...globalConfig, id: 50, scope: 'group' as const, display_name: 'Team Whisper' }
      mockNs.upsert.mockResolvedValueOnce({ config: created })

      const store = useSpeechProviderConfigsStore()
      await store.upsert({
        provider_class: openAiProvider.class,
        scope: 'group',
        settings: { api_key: 'sk-team' },
        group_id: 7,
      })

      expect(mockNs.upsert).toHaveBeenCalledWith({
        provider_class: openAiProvider.class,
        scope: 'group',
        settings: { api_key: 'sk-team' },
        group_id: 7,
      })
    })

    it('sets error and rethrows on a 4xx failure', async () => {
      mockNs.upsert.mockRejectedValueOnce(new ApiError('base_url is invalid', 'VALIDATION_ERROR', 400))

      const store = useSpeechProviderConfigsStore()
      await expect(store.upsert({
        provider_class: openAiProvider.class,
        scope: 'user',
        settings: {},
      })).rejects.toThrow(ApiError)

      expect(store.error).toBe('base_url is invalid')
    })
  })

  describe('update', () => {
    it('puts to /:id and does NOT mutate any slot cache', async () => {
      const updated = { ...globalConfig, display_name: 'Renamed' }
      mockNs.update.mockResolvedValueOnce({ config: updated })

      const store = useSpeechProviderConfigsStore()
      store.getSlot('user').configs = [userConfig]

      const result = await store.update(7, { settings: { model: 'voxtral-mini-latest' } })

      expect(mockNs.update).toHaveBeenCalledWith(7, { settings: { model: 'voxtral-mini-latest' } })
      expect(result).toEqual(updated)
      // Caller refreshes via loadConfigsFor(slotKey) in onSaved —
      // the mutation leaves the slot cache untouched.
      expect(store.getSlot('user').configs).toEqual([userConfig])
    })
  })

  describe('remove', () => {
    it('calls the DELETE endpoint without mutating any slot cache (caller refreshes)', async () => {
      mockNs.delete.mockResolvedValueOnce({ deleted: true })

      const store = useSpeechProviderConfigsStore()
      store.getSlot('user').configs = [globalConfig, userConfig]
      await store.remove(7)

      expect(mockNs.delete).toHaveBeenCalledWith(7)
      expect(mockNs.list).not.toHaveBeenCalled()
      // The cache is intentionally untouched — the caller refreshes via
      // `loadConfigsFor(slotKey)` after the form emits 'deleted'. This
      // avoids a microtask race in vue-router 5.x where the form would
      // unmount mid-`await` and lose its `deleted` listener before Vue
      // could dispatch it to the parent.
      expect(store.getSlot('user').configs).toEqual([globalConfig, userConfig])
    })
  })

  describe('setDefault', () => {
    it('POSTs the id and does NOT mutate any slot cache', async () => {
      const promoted = { ...globalConfig, is_default: true }
      mockNs.setDefault.mockResolvedValueOnce({ config: promoted })

      const store = useSpeechProviderConfigsStore()
      store.getSlot('user').configs = [globalConfig]
      const result = await store.setDefault(7)

      expect(mockNs.setDefault).toHaveBeenCalledWith(7)
      expect(result).toEqual(promoted)
      // Caller refreshes via loadConfigsFor(slotKey) — the badge keys
      // off `is_default` from the freshly-loaded row.
      expect(store.getSlot('user').configs).toEqual([globalConfig])
    })

    it('sets error and rethrows on a 4xx failure', async () => {
      mockNs.setDefault.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await expect(store.setDefault(7)).rejects.toThrow(ApiError)
      expect(store.error).toBe('Forbidden')
    })
  })

  describe('setPreferred', () => {
    it('PUTs the preference and returns the envelope (slot untouched — caller writes via setPreferredSlot)', async () => {
      const preference = { config_id: userConfig.id, scope: 'user' as const, group_id: null }
      mockNs.setPreferred.mockResolvedValueOnce({ preference })

      const store = useSpeechProviderConfigsStore()
      const result = await store.setPreferred({
        config_id: userConfig.id,
        scope: 'user',
      })

      expect(mockNs.setPreferred).toHaveBeenCalledWith({
        config_id: userConfig.id,
        scope: 'user',
      })
      expect(result).toEqual(preference)
      // The slot is NOT mutated by setPreferred — the caller writes
      // via `store.setPreferredSlot(key, value)` so the UI mirror
      // appears immediately without a full slot reload.
      expect(store.getSlot('user').preferredSpeech).toBeNull()
    })

    it('accepts null config_id to clear the preference', async () => {
      const cleared = { config_id: null, scope: 'user' as const, group_id: null }
      mockNs.setPreferred.mockResolvedValueOnce({ preference: cleared })

      const store = useSpeechProviderConfigsStore()
      const result = await store.setPreferred({ config_id: null, scope: 'user' })

      expect(mockNs.setPreferred).toHaveBeenCalledWith({
        config_id: null,
        scope: 'user',
      })
      expect(result).toEqual(cleared)
    })

    it('sets error and rethrows on failure', async () => {
      mockNs.setPreferred.mockRejectedValueOnce(new ApiError('nope', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await expect(store.setPreferred({
        config_id: userConfig.id,
        scope: 'user',
      })).rejects.toThrow(ApiError)
      expect(store.error).toBe('nope')
    })
  })

  describe('setPreferredSlot', () => {
    it('updates only the named slot', () => {
      const store = useSpeechProviderConfigsStore()
      store.setPreferredSlot('user', { config_id: 12, scope: 'user', group_id: null })
      store.setPreferredSlot(42, { config_id: 99, scope: 'group', group_id: 5 })

      expect(store.getSlot('user').preferredSpeech?.config_id).toBe(12)
      expect(store.getSlot(42).preferredSpeech?.config_id).toBe(99)
      // Other slots remain at their default null — no cross-slot pollution.
      expect(store.getSlot(7).preferredSpeech).toBeNull()
    })

    it('accepts null to clear the slot preference', () => {
      const store = useSpeechProviderConfigsStore()
      store.getSlot('user').preferredSpeech = { config_id: 12, scope: 'user', group_id: null }
      store.setPreferredSlot('user', null)
      expect(store.getSlot('user').preferredSpeech).toBeNull()
    })
  })

  describe('non-pollution on mutation actions', () => {
    it('does not touch slots when upsert / update / setDefault / setPreferred succeed — caller refreshes', async () => {
      mockNs.upsert.mockResolvedValueOnce({ config: { ...userConfig, id: 999 } })
      mockNs.update.mockResolvedValueOnce({ config: { ...userConfig, display_name: 'Renamed' } })
      mockNs.setDefault.mockResolvedValueOnce({ config: { ...userConfig, is_default: true } })
      mockNs.setPreferred.mockResolvedValueOnce({ preference: { config_id: userConfig.id, scope: 'user' as const, group_id: null } })

      const store = useSpeechProviderConfigsStore()
      store.getSlot('user').configs = [userConfig]
      store.getSlot(42).configs = [globalConfig]
      const beforeUser = [...store.getSlot('user').configs]
      const beforeAgent = [...store.getSlot(42).configs]

      await store.upsert({ provider_class: openAiProvider.class, scope: 'user', settings: {} })
      await store.update(userConfig.id, { display_name: 'x' })
      await store.setDefault(userConfig.id)
      await store.setPreferred({ config_id: userConfig.id, scope: 'user' })

      expect(store.getSlot('user').configs).toEqual(beforeUser)
      expect(store.getSlot(42).configs).toEqual(beforeAgent)
      expect(store.getSlot('user').preferredSpeech).toBeNull()
    })
  })

  describe('slot isolation under loadConfigsFor', () => {
    it("group-page loadConfigsFor(7) does not pollute the agent slot or other group slots", async () => {
      const groupA = { ...globalConfig, id: 50, scope: 'group' as const, display_name: 'Team A', principal_id: 1 }
      const groupB = { ...globalConfig, id: 70, scope: 'group' as const, display_name: 'Team B', principal_id: 2 }
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [groupB] })

      const store = useSpeechProviderConfigsStore()
      // Seed an unrelated agent slot and another group slot.
      store.getSlot(42).configs = [{ ...globalConfig, id: 100 }]
      store.getSlot(7).configs = [groupA]

      await store.loadConfigsFor(9) // loading group 9 should not touch group 7's slot

      expect(store.getSlot(9).configs).toEqual([groupB])
      // Group 7's slot is untouched.
      expect(store.getSlot(7).configs).toEqual([groupA])
      // The agent slot is untouched.
      expect(store.getSlot(42).configs).toEqual([{ ...globalConfig, id: 100 }])
    })
  })

  describe('providerByClass', () => {
    it('returns the provider matching the FQCN', () => {
      const store = useSpeechProviderConfigsStore()
      store.providers = [openAiProvider, museProvider]

      expect(store.providerByClass(openAiProvider.class)).toEqual(openAiProvider)
      expect(store.providerByClass(museProvider.class)).toEqual(museProvider)
    })

    it('returns undefined for an unknown class', () => {
      const store = useSpeechProviderConfigsStore()
      store.providers = []

      expect(store.providerByClass('Unknown\\Class')).toBeUndefined()
    })
  })
})
