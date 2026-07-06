/**
 * useFeatureEnabled — reads the runtime feature flag from the Pinia store,
 * which fetches `GET /api/v1/config` on every page reload. Returns `false`
 * whenever the store hasn't finished its initial fetch (safety: never default
 * to `true` before the server has been consulted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
    }
  },
}))

// Import after the mock so the store picks up the mocked api client.
import { api } from '@/api/client'
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

describe('useFeatureEnabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false before the store has initialised (safety default)', () => {
    const flag = useFeatureEnabled('plugin_install')
    expect(flag.value).toBe(false)
  })

  it('returns true after init when plugin_install_enabled is true', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: true,
      plugin_catalog_enabled: true,
    })
    const store = useRuntimeConfigStore()
    await store.init()
    const flag = useFeatureEnabled('plugin_install')
    expect(flag.value).toBe(true)
  })

  it('returns false after init when plugin_install_enabled is false', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: false,
      plugin_catalog_enabled: true,
    })
    const store = useRuntimeConfigStore()
    await store.init()
    const flag = useFeatureEnabled('plugin_install')
    expect(flag.value).toBe(false)
  })

  it('fails closed for plugin_install_enabled when the endpoint errors', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network down'))
    const store = useRuntimeConfigStore()
    await store.init()
    const flag = useFeatureEnabled('plugin_install')
    expect(flag.value).toBe(false)
    // And the store marks itself as initialised even on failure so the
    // router guard stops blocking — see runtimeConfig.ts header.
    expect(store.initialized).toBe(true)
  })

  it('reads plugin_catalog_enabled from the same store', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: false,
      plugin_catalog_enabled: true,
    })
    const store = useRuntimeConfigStore()
    await store.init()
    const flag = useFeatureEnabled('plugin_catalog')
    expect(flag.value).toBe(true)
  })
})