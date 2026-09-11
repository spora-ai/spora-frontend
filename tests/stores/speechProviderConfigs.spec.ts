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
  created_at: '2026-09-11T12:34:56Z',
  updated_at: '2026-09-11T12:34:56Z',
}

const userConfig = {
  ...globalConfig,
  id: 12,
  scope: 'user' as const,
  display_name: 'Personal Mistral',
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
  })

  describe('loadConfigs', () => {
    it('fetches configs and stores them', async () => {
      mockNs.list.mockResolvedValueOnce({ configs: [globalConfig, userConfig] })

      const store = useSpeechProviderConfigsStore()
      await store.loadConfigs()

      expect(mockNs.list).toHaveBeenCalledWith()
      expect(store.configs).toEqual([globalConfig, userConfig])
      expect(store.loadingConfigs).toBe(false)
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
    it('deletes from the API and refreshes the cache', async () => {
      mockNs.delete.mockResolvedValueOnce({ deleted: true })
      mockNs.list.mockResolvedValueOnce({ configs: [] })

      const store = useSpeechProviderConfigsStore()
      store.configs = [globalConfig]
      await store.remove(7)

      expect(mockNs.delete).toHaveBeenCalledWith(7)
      expect(store.configs).toEqual([])
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
