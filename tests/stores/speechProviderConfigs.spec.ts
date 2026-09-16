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

// Pre-populate the active store's `configs` ref with one row each. Used
// by loadForGroup tests that need the unscoped cache to already hold
// something before the group fetch merges in.
function storeWith(rows: Array<typeof globalConfig>): void {
  const store = useSpeechProviderConfigsStore()
  store.configs = rows
}

describe('useSpeechProviderConfigsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    // Default: 404 on getPreference so loadPreference leaves the
    // preferredSpeech ref as null without surfacing an error. Individual
    // tests override this when they want a hydrated preference.
    mockNs.getPreference.mockRejectedValue(new ApiError('Not Found', 'NOT_FOUND', 404))
  })

  describe('loadConfigs', () => {
    it('fetches configs and stores them', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig, userConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigs()

      // Backend call may now pass `undefined` so the API client's
      // agent-scope branch stays in sync with the store signature;
      // either no args or a single `undefined` arg is acceptable.
      const listCalls = mockNs.list.mock.calls
      expect(listCalls.length).toBe(1)
      expect(listCalls[0][0]).toBeUndefined()
      expect(store.configs).toEqual([globalConfig, userConfig])
      expect(store.loadingConfigs).toBe(false)
    })

    it('forwards agentId to the API so the backend narrows by agent scope', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigs(99)

      expect(mockNs.list).toHaveBeenCalledWith(99)
      expect(store.configs).toEqual([globalConfig])
    })

    it('stores the error message on a 4xx failure', async () => {
      mockNs.list.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigs()

      expect(store.error).toBe('Forbidden')
      expect(store.loadingConfigs).toBe(false)
    })

    it('uses a generic message when the rejection is not an ApiError', async () => {
      mockNs.list.mockRejectedValueOnce(new Error('network died'))

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigs()

      expect(store.error).toBe('Failed to load speech provider configurations.')
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

  describe('loadForGroup', () => {
    const groupConfig = {
      ...globalConfig,
      id: 50,
      scope: 'group' as const,
      display_name: 'Team Whisper',
    }

    it('fetches configs scoped to the group and merges into the cache', async () => {
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [groupConfig] })

      const store = useSpeechProviderConfigsStore()
      const result = await store.loadForGroup(7)

      expect(mockNs.listForGroup).toHaveBeenCalledWith(7)
      expect(result).toEqual([groupConfig])
      expect(store.groupConfigs).toEqual([groupConfig])
      expect(store.loadingConfigs).toBe(false)
    })

    it('preserves unrelated rows in the cache after the merge', async () => {
      storeWith([globalConfig])
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [groupConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadForGroup(7)

      // Both the previously cached global row AND the freshly loaded
      // group row survive — loadForGroup is additive, not destructive.
      const ids = store.configs.map((c) => c.id).sort()
      expect(ids).toEqual([globalConfig.id, groupConfig.id].sort())
      expect(store.groupConfigs.map((c) => c.id)).toEqual([groupConfig.id])
    })

    it('surfaces an ApiError via the store error and rethrows', async () => {
      mockNs.listForGroup.mockRejectedValueOnce(new ApiError('nope', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await expect(store.loadForGroup(7)).rejects.toBeInstanceOf(ApiError)
      expect(store.error).toBe('nope')
      expect(store.loadingConfigs).toBe(false)
    })

    it('drops group-scope rows from a previous group visit so groupConfigs only holds the current group', async () => {
      // Operator previously opened `/groups/3/speech` — that visit left
      // group 3's config in the unscoped cache. Now opening `/groups/9/speech`
      // must remove group 3's row so the new page only shows group 9.
      const groupAConfig = { ...globalConfig, id: 60, scope: 'group' as const, display_name: 'Group3', principal_id: 700 }
      const groupBConfig = { ...globalConfig, id: 70, scope: 'group' as const, display_name: 'Group9', principal_id: 900 }
      storeWith([groupAConfig])
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [groupBConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadForGroup(9)

      // Group A's row dropped, group B's row in — `groupConfigs` should
      // contain only the freshly-loaded group 9 row, not the stale
      // group 3 row from the previous visit.
      expect(store.configs.map((c) => c.id).sort()).toEqual([groupBConfig.id])
      expect(store.groupConfigs.map((c) => c.id)).toEqual([groupBConfig.id])
    })

    it('keeps user-scope and global-scope rows from the cache when loading a group', async () => {
      const userScoped = { ...globalConfig, id: 80, scope: 'user' as const, display_name: 'Personal', is_default: false }
      const groupScoped = { ...globalConfig, id: 90, scope: 'group' as const, display_name: 'Scoped', principal_id: 1234 }
      storeWith([globalConfig, userScoped])
      mockNs.listForGroup.mockResolvedValueOnce({ configs: [groupScoped] })

      const store = useSpeechProviderConfigsStore()
      await store.loadForGroup(5)

      const ids = store.configs.map((c) => c.id).sort()
      // Global + user survive, group 5's row added, nothing from a
      // previous group visit lingers.
      expect(ids).toEqual([globalConfig.id, userScoped.id, groupScoped.id].sort())
    })
  })

  describe('ensure', () => {
    it('loads configs and providers on first call', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValueOnce({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure()

      expect(store.configs).toEqual([globalConfig])
      expect(store.providers).toEqual([openAiProvider])
      expect(store.initialized).toBe(true)
    })

    it('is idempotent — a second call does not refetch', async () => {
      mockNs.list.mockResolvedValue({ configs: [globalConfig] })
      mockNs.listSchema.mockResolvedValue({ providers: [openAiProvider] })

      const store = useSpeechProviderConfigsStore()
      await store.ensure()
      await store.ensure()

      expect(mockNs.list).toHaveBeenCalledTimes(1)
      expect(mockNs.listSchema).toHaveBeenCalledTimes(1)
    })

    it('remains initialized even when loading fails (no retry loop)', async () => {
      mockNs.list.mockRejectedValue(new ApiError('Server error', 'UNKNOWN', 500))
      mockNs.listSchema.mockRejectedValue(new ApiError('Server error', 'UNKNOWN', 500))

      const store = useSpeechProviderConfigsStore()
      await store.ensure()

      expect(store.initialized).toBe(true)
      expect(store.error).toBeTruthy()
    })

    it('hydrates preferredSpeech when GET /preference returns a row', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [] })
      mockNs.listSchema.mockResolvedValueOnce({ providers: [] })
      mockNs.getPreference.mockResolvedValueOnce({
        preference: {
          provider_class: openAiProvider.class,
          scope: 'user',
          group_id: null,
        },
      })

      const store = useSpeechProviderConfigsStore()
      await store.ensure()

      expect(store.preferredSpeech).toEqual({
        provider_class: openAiProvider.class,
        scope: 'user',
        group_id: null,
      })
    })
  })

  describe('loadPreference', () => {
    it('sets preferredSpeech from the envelope', async () => {
      mockNs.getPreference.mockResolvedValueOnce({
        preference: { config_id: userConfig.id, scope: 'user', group_id: null },
      })

      const store = useSpeechProviderConfigsStore()
      await store.loadPreference()

      expect(store.preferredSpeech?.config_id).toBe(userConfig.id)
      expect(store.error).toBeNull()
    })

    it('treats 404 as "no preference yet" without surfacing an error', async () => {
      mockNs.getPreference.mockRejectedValueOnce(new ApiError('Not Found', 'NOT_FOUND', 404))

      const store = useSpeechProviderConfigsStore()
      await store.loadPreference()

      expect(store.preferredSpeech).toBeNull()
      expect(store.error).toBeNull()
    })

    it('surfaces non-404 ApiError via store.error', async () => {
      mockNs.getPreference.mockRejectedValueOnce(new ApiError('Server error', 'UNKNOWN', 500))

      const store = useSpeechProviderConfigsStore()
      await store.loadPreference()

      expect(store.preferredSpeech).toBeNull()
      expect(store.error).toBe('Server error')
    })
  })

  describe('upsert', () => {
    it('posts to the namespace and refreshes the cache', async () => {
      const created = { ...globalConfig, id: 99, display_name: 'New' }
      mockNs.upsert.mockResolvedValueOnce({ config: created })
      mockNs.list.mockResolvedValueOnce({ configs: [created] })

      const store = useSpeechProviderConfigsStore()
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
      // Cache was refreshed — the new config is visible in the list
      expect(store.configs).toEqual([created])
    })

    it('forwards display_name on the payload when the form provided one', async () => {
      // Regression: prior to the wire-shape fix, `display_name` lived only
      // inside the settings map and the new backend silently fell back to
      // the FQCN — operators creating "Mistral Voxtral (prod)" saw
      // `display_name = Spora\\Speech\\OpenAiCompatibleTranscriber` in the
      // list. The store must hand the top-level field through untouched.
      const created = { ...globalConfig, id: 99, display_name: 'Mistral Voxtral (prod)' }
      mockNs.upsert.mockResolvedValueOnce({ config: created })
      mockNs.list.mockResolvedValueOnce({ configs: [created] })

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
      mockNs.list.mockResolvedValueOnce({ configs: [created] })

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
    it('puts to /:id and refreshes the cache', async () => {
      const updated = { ...globalConfig, display_name: 'Renamed' }
      mockNs.update.mockResolvedValueOnce({ config: updated })
      mockNs.list.mockResolvedValueOnce({ configs: [updated] })

      const store = useSpeechProviderConfigsStore()
      store.configs = [globalConfig]
      const result = await store.update(7, { settings: { model: 'voxtral-mini-latest' } })

      expect(mockNs.update).toHaveBeenCalledWith(7, { settings: { model: 'voxtral-mini-latest' } })
      expect(result).toEqual(updated)
      expect(store.configs).toEqual([updated])
    })
  })

  describe('remove', () => {
    it('calls the DELETE endpoint without mutating the local cache (caller refreshes)', async () => {
      mockNs.delete.mockResolvedValueOnce({ deleted: true })

      const store = useSpeechProviderConfigsStore()
      store.configs = [globalConfig]
      await store.remove(7)

      expect(mockNs.delete).toHaveBeenCalledWith(7)
      expect(mockNs.list).not.toHaveBeenCalled()
      // The cache is intentionally untouched — the caller refreshes via
      // `loadConfigs()` after the form emits 'deleted'. This avoids a
      // microtask race in vue-router 5.x where the form would unmount
      // mid-`await` and lose its `deleted` listener before Vue could
      // dispatch it to the parent.
      expect(store.configs).toEqual([globalConfig])
    })
  })

  describe('setDefault', () => {
    it('POSTs the id and refreshes the cache', async () => {
      const promoted = { ...globalConfig, is_default: true }
      mockNs.setDefault.mockResolvedValueOnce({ config: promoted })
      mockNs.list.mockResolvedValueOnce({ configs: [promoted] })

      const store = useSpeechProviderConfigsStore()
      const result = await store.setDefault(7)

      expect(mockNs.setDefault).toHaveBeenCalledWith(7)
      expect(result).toEqual(promoted)
      expect(store.configs).toEqual([promoted])
    })

    it('sets error and rethrows on a 4xx failure', async () => {
      mockNs.setDefault.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))

      const store = useSpeechProviderConfigsStore()
      await expect(store.setDefault(7)).rejects.toThrow(ApiError)
      expect(store.error).toBe('Forbidden')
    })
  })

  describe('setPreferred', () => {
    it('PUTs the preference and returns the envelope', async () => {
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
        provider_class: openAiProvider.class,
        scope: 'user',
      })).rejects.toThrow(ApiError)
      expect(store.error).toBe('nope')
    })
  })

  describe('getters', () => {
    it('personalConfigs filters by scope=user', () => {
      const store = useSpeechProviderConfigsStore()
      store.configs = [globalConfig, userConfig]

      expect(store.personalConfigs).toEqual([userConfig])
    })

    it('globalConfigs filters by scope=global', () => {
      const store = useSpeechProviderConfigsStore()
      store.configs = [globalConfig, userConfig]

      expect(store.globalConfigs).toEqual([globalConfig])
    })

    it('groupConfigs filters by scope=group', () => {
      const store = useSpeechProviderConfigsStore()
      const groupRow = { ...globalConfig, id: 33, scope: 'group' as const, display_name: 'Group Whisper' }
      store.configs = [globalConfig, userConfig, groupRow]

      expect(store.groupConfigs).toEqual([groupRow])
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
