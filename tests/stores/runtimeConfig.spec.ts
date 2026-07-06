/**
 * useRuntimeConfigStore — single source of runtime feature flags for the SPA.
 *
 * Tests cover: success path, dedupe of concurrent init() calls, fail-open for
 * `allow_registration`, fail-closed for the two admin gates, and that
 * `initialized` becomes true even on failure so the router guard stops
 * blocking navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
    }
  },
}))

import { api } from '@/api/client'
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

describe('useRuntimeConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets all three flags on a successful fetch', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: true,
      plugin_catalog_enabled: false,
    })

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.allowRegistration).toBe(true)
    expect(store.pluginInstallEnabled).toBe(true)
    expect(store.pluginCatalogEnabled).toBe(false)
    expect(store.initialized).toBe(true)
    expect(store.initError).toBeNull()
  })

  it('dedupes concurrent init() calls (one fetch, shared state)', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: true,
      plugin_catalog_enabled: true,
    })

    const store = useRuntimeConfigStore()
    await Promise.all([store.init(), store.init(), store.init()])

    expect(mockApi.get).toHaveBeenCalledTimes(1)
    expect(store.pluginInstallEnabled).toBe(true)
  })

  it('fails open for allow_registration and closed for the admin gates on API error', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network down'))

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.allowRegistration).toBe(true)
    expect(store.pluginInstallEnabled).toBe(false)
    expect(store.pluginCatalogEnabled).toBe(false)
  })

  it('marks initialized=true even on failure so the router guard stops blocking', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('boom'))

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.initialized).toBe(true)
    expect(store.initError).not.toBeNull()
  })

  it('retries on the next init() call after a failure', async () => {
    mockApi.get
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        allow_registration: false,
        plugin_install_enabled: true,
        plugin_catalog_enabled: true,
      })

    const store = useRuntimeConfigStore()
    await store.init()
    expect(store.initialized).toBe(true)
    expect(store.pluginInstallEnabled).toBe(false)

    await store.init()
    expect(store.pluginInstallEnabled).toBe(true)
    expect(mockApi.get).toHaveBeenCalledTimes(2)
  })

  it('flagFor maps plugin_install and plugin_catalog to the right ref', async () => {
    mockApi.get.mockResolvedValueOnce({
      allow_registration: true,
      plugin_install_enabled: true,
      plugin_catalog_enabled: false,
    })

    const store = useRuntimeConfigStore()
    await store.init()

    expect(store.flagFor('plugin_install')).toBe(true)
    expect(store.flagFor('plugin_catalog')).toBe(false)
  })
})