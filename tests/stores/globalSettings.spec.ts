import { setActivePinia, createPinia } from 'pinia'
import { watch } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
}))

vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: vi.fn(() => ({
    getGlobalSettings: vi.fn().mockResolvedValue({}),
    putSettings: vi.fn().mockResolvedValue({}),
  })),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({
    initialized: true,
    init: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { api, ApiError } from '@/api/client'
import { useToolSettings } from '@/composables/useToolSettings'
import { useAuthStore } from '@/stores/auth'

const mockApi = api as ReturnType<typeof vi.fn>
const mockToolSettings = useToolSettings as ReturnType<typeof vi.fn>

const mockTools = [
  {
    tool_class: String.raw`Spora\Tools\TavilyTool`,
    tool_name: 'tavily',
    display_name: 'Tavily',
    category: 'search',
    settings_schema: [
      { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, scope: 'global', options: null },
    ],
    operations: [],
  },
]

function setting(overrides: Record<string, unknown> = {}) {
  return {
    key: 'SPORA_KEY',
    group: 'framework',
    label: 'A setting',
    type: 'text',
    description: '',
    value: '',
    default: '',
    source: 'default',
    readonly: false,
    secret: false,
    undecryptable: false,
    options: [],
    ...overrides,
  }
}

const settingsPayload = {
  sections: [
    {
      key: 'general',
      label: 'General',
      settings: [
        setting({ key: 'SPORA_ALLOW_REGISTRATION', source: 'env', value: false }),
        setting({ key: 'SPORA_MAIL_PASSWORD', source: 'env', value: 'secret-1', secret: true }),
        setting({ key: 'SPORA_API_TOKEN', source: 'env', value: 'stale', secret: true, undecryptable: true }),
      ],
    },
  ],
  undecryptable: ['SPORA_API_TOKEN'],
}

describe('useGlobalSettingsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // resetAllMocks clears the factory's return value too, so re-arm it.
    mockToolSettings.mockReturnValue({
      getGlobalSettings: vi.fn().mockResolvedValue({}),
      putSettings: vi.fn().mockResolvedValue({}),
    })
    setActivePinia(createPinia())
  })

  describe('fetchSettings', () => {
    it('reads the sections and the undecryptable key list', async () => {
      mockApi.get.mockResolvedValueOnce(settingsPayload)

      const store = useGlobalSettingsStore()
      await store.fetchSettings()

      expect(mockApi.get).toHaveBeenCalledWith('/admin/settings')
      expect(store.sections).toHaveLength(1)
      expect(store.sections[0].settings.map((s) => s.key)).toEqual([
        'SPORA_ALLOW_REGISTRATION',
        'SPORA_MAIL_PASSWORD',
        'SPORA_API_TOKEN',
      ])
      expect(store.undecryptable).toEqual(['SPORA_API_TOKEN'])
      expect(store.loading).toBe(false)
    })

    it('records the error and rethrows so the page can toast', async () => {
      mockApi.get.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Admin access required', 403))

      const store = useGlobalSettingsStore()
      await expect(store.fetchSettings()).rejects.toThrow('Admin access required')

      expect(store.error).toBe('Admin access required')
      expect(store.loading).toBe(false)
    })
  })

  describe('save', () => {
    it('patches the keys it was handed, then re-reads so the page agrees with the server', async () => {
      // A PATCH answers with keys and no values. The GET that follows is what
      // makes the stored value authoritative — patching the sent value back in
      // locally would show something the server may have transformed.
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockResolvedValueOnce({ updated: ['SPORA_ALLOW_REGISTRATION', 'SPORA_MAIL_PASSWORD'] })
      const reloaded = structuredClone(settingsPayload)
      reloaded.sections[0].settings[0].source = 'database'
      reloaded.sections[0].settings[0].value = true
      reloaded.sections[0].settings[1].source = 'database'
      reloaded.sections[0].settings[1].value = '***'
      mockApi.get.mockResolvedValueOnce(reloaded)

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      const updated = await store.save([
        { group: 'general', key: 'SPORA_ALLOW_REGISTRATION', value: true },
        { group: 'general', key: 'SPORA_MAIL_PASSWORD', value: 'secret-2' },
      ])

      expect(mockApi.patch).toHaveBeenCalledWith('/admin/settings', {
        settings: [
          { group: 'general', key: 'SPORA_ALLOW_REGISTRATION', value: true },
          { group: 'general', key: 'SPORA_MAIL_PASSWORD', value: 'secret-2' },
        ],
      })
      expect(updated).toEqual(['SPORA_ALLOW_REGISTRATION', 'SPORA_MAIL_PASSWORD'])
      expect(mockApi.get).toHaveBeenCalledTimes(2)

      const byKey = Object.fromEntries(store.sections[0].settings.map((s) => [s.key, s]))
      expect(byKey.SPORA_ALLOW_REGISTRATION.source).toBe('database')
      // The secret is masked again by the server, so the next render shows the
      // locked display rather than the plaintext that was just typed.
      expect(byKey.SPORA_MAIL_PASSWORD.value).toBe('***')
      expect(byKey.SPORA_API_TOKEN.source).toBe('env')
      expect(store.saving).toBe(false)
    })

    it('shows the server\'s value, not the one it was handed', async () => {
      // The server normalises a legacy spelling on the way in. Echoing the sent
      // value back would leave the field holding something that was never
      // stored.
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockResolvedValueOnce({ updated: ['SPORA_APP_NAME'] })
      const reloaded = structuredClone(settingsPayload)
      reloaded.sections[0].settings[0].value = 'renamed-by-server'
      mockApi.get.mockResolvedValueOnce(reloaded)

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      await store.save([{ group: 'general', key: 'SPORA_APP_NAME', value: 'what-i-typed' }])

      expect(store.sections[0].settings[0].value).toBe('renamed-by-server')
    })

    it('does not blank the page while re-reading', async () => {
      // `loading` hides the table, and a table that blanks itself on every save
      // turns an ordinary edit into a page reload.
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockResolvedValueOnce({ updated: ['SPORA_APP_NAME'] })
      mockApi.get.mockResolvedValueOnce(settingsPayload)

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      const peak: boolean[] = []
      const stop = watch(store.loading, (value) => peak.push(value))

      await store.save([{ group: 'general', key: 'SPORA_APP_NAME', value: 'x' }])
      stop()

      expect(peak).not.toContain(true)
    })

    it('reports the save as successful when only the re-read fails', async () => {
      // The PATCH landed; the GET after it did not. Rejecting here would send
      // the operator off to save the same thing again, and the second attempt
      // would write it a second time.
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockResolvedValueOnce({ updated: ['SPORA_APP_NAME'] })
      mockApi.get.mockRejectedValueOnce(new Error('network down'))

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      const updated = await store.save([{ group: 'general', key: 'SPORA_APP_NAME', value: 'x' }])

      expect(updated).toEqual(['SPORA_APP_NAME'])
      // Whatever was on screen stays there rather than becoming empty.
      expect(store.sections[0].settings.map((s) => s.key))
        .toEqual(settingsPayload.sections[0].settings.map((s) => s.key))
    })

    it('still reports a write that did not land as a failure', async () => {
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockRejectedValueOnce(new Error('rejected'))

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      await expect(store.save([{ group: 'general', key: 'SPORA_APP_NAME', value: 'x' }]))
        .rejects.toThrow()

      expect(store.error).toBe('Failed to save global settings.')
      expect(mockApi.get).toHaveBeenCalledTimes(1)
    })

    it('clears a key from the undecryptable list once it is rewritten', async () => {
      mockApi.get.mockResolvedValueOnce(settingsPayload)
      mockApi.patch.mockResolvedValueOnce({ updated: ['SPORA_API_TOKEN'] })
      mockApi.get.mockResolvedValueOnce({
        ...settingsPayload,
        undecryptable: [],
        sections: [
          {
            ...settingsPayload.sections[0],
            settings: settingsPayload.sections[0].settings.map((s) =>
              s.key === 'SPORA_API_TOKEN' ? { ...s, undecryptable: false, source: 'database' } : s,
            ),
          },
        ],
      })

      const store = useGlobalSettingsStore()
      await store.fetchSettings()
      await store.save([{ group: 'general', key: 'SPORA_API_TOKEN', value: 'fresh' }])

      expect(store.undecryptable).toEqual([])
      expect(store.sections[0].settings[2].undecryptable).toBe(false)
    })

    it('records the error and rethrows so the page can toast', async () => {
      mockApi.patch.mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'Unknown key', 422))

      const store = useGlobalSettingsStore()
      await expect(
        store.save([{ group: 'general', key: 'SPORA_NOPE', value: '1' }]),
      ).rejects.toThrow('Unknown key')

      expect(store.error).toBe('Unknown key')
      expect(store.saving).toBe(false)
    })
  })

  describe('resetSetting', () => {
    it('deletes the key and re-reads the registry', async () => {
      mockApi.get.mockResolvedValue(settingsPayload)
      mockApi.delete.mockResolvedValueOnce({ reset: ['SPORA_ALLOW_REGISTRATION'] })

      const store = useGlobalSettingsStore()
      await store.resetSetting('framework', 'SPORA_ALLOW_REGISTRATION')

      expect(mockApi.delete).toHaveBeenCalledWith('/admin/settings/framework/SPORA_ALLOW_REGISTRATION')
      // The DELETE response names the key but not the layer it fell back to.
      expect(mockApi.get).toHaveBeenCalledWith('/admin/settings')
      expect(mockApi.get).toHaveBeenCalledTimes(1)
      expect(store.saving).toBe(false)
    })

    it('records the error and rethrows so the page can toast', async () => {
      mockApi.delete.mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'Unknown key', 422))

      const store = useGlobalSettingsStore()
      await expect(store.resetSetting('general', 'SPORA_NOPE')).rejects.toThrow('Unknown key')

      expect(store.error).toBe('Unknown key')
      expect(store.saving).toBe(false)
    })
  })

  describe('loadTools', () => {
    it('fetches tools from /tools endpoint', async () => {
      // The raw API response is { data: { tools: [...] } }
      // client.ts unwraps the 'data' envelope, so api.get() returns { tools: [...] }
      mockApi.get.mockResolvedValueOnce({ tools: mockTools })

      const store = useGlobalSettingsStore()
      await store.loadTools()

      expect(mockApi.get).toHaveBeenCalledWith('/tools')
      expect(store.allTools).toEqual(mockTools)
    })

    it('sets toolError on failure', async () => {
      mockApi.get.mockRejectedValueOnce(new ApiError('SERVER_ERROR', 'Server error', 500))

      const store = useGlobalSettingsStore()
      await store.loadTools()

      expect(store.toolError).toBe('Server error')
    })

    it('awaits auth.init() when auth is not yet initialized', async () => {
      const mockAuthStore = vi.mocked(useAuthStore)
      mockAuthStore.mockReturnValue({
        initialized: false,
        init: vi.fn().mockResolvedValue(undefined),
      })
      mockApi.get.mockResolvedValueOnce({ tools: mockTools })

      const store = useGlobalSettingsStore()
      await store.loadTools()

      expect(mockAuthStore().init).toHaveBeenCalled()
      expect(store.allTools).toEqual(mockTools)
    })

    it('does not call auth.init() when already initialized', async () => {
      const mockAuthStore = vi.mocked(useAuthStore)
      mockAuthStore.mockReturnValue({
        initialized: true,
        init: vi.fn(),
      })
      mockApi.get.mockResolvedValueOnce({ tools: mockTools })

      const store = useGlobalSettingsStore()
      await store.loadTools()

      expect(mockAuthStore().init).not.toHaveBeenCalled()
      expect(store.allTools).toEqual(mockTools)
    })
  })

  describe('loadToolSettings', () => {
    it('loads the registry first when no tools are loaded yet', async () => {
      mockApi.get.mockResolvedValueOnce({ tools: mockTools })

      const store = useGlobalSettingsStore()
      await store.loadToolSettings()

      expect(mockApi.get).toHaveBeenCalledWith('/tools')
      expect(mockToolSettings().getGlobalSettings).toHaveBeenCalledWith('tavily')
      expect(store.toolSettings.tavily).toEqual({})
    })

    it('falls back to an empty record when a tool has no stored settings', async () => {
      mockToolSettings.mockReturnValue({
        getGlobalSettings: vi.fn().mockRejectedValue(new Error('nope')),
        putSettings: vi.fn(),
      })
      mockApi.get.mockResolvedValueOnce({ tools: mockTools })

      const store = useGlobalSettingsStore()
      await store.loadToolSettings()

      expect(store.toolSettings.tavily).toEqual({})
    })
  })
})