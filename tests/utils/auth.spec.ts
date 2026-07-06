import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fetchConfig, isRegistrationEnabled, clearConfigCache } from '@/utils/auth'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
  },
}))

import { api } from '@/api/client'

const getMock = api.get as ReturnType<typeof vi.fn>

describe('auth utils', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getMock.mockReset()
    clearConfigCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchConfig', () => {
    it('returns all three runtime feature flag keys when the endpoint succeeds', async () => {
      getMock.mockResolvedValueOnce({
        allow_registration: true,
        plugin_install_enabled: false,
        plugin_catalog_enabled: true,
      })

      const config = await fetchConfig()

      expect(config.allow_registration).toBe(true)
      expect(config.plugin_install_enabled).toBe(false)
      expect(config.plugin_catalog_enabled).toBe(true)
      expect(getMock).toHaveBeenCalledWith('/config')
    })

    it('fails open (allow_registration=true) and closed for the admin flags when the API call throws', async () => {
      getMock.mockRejectedValueOnce(new Error('network error'))

      const config = await fetchConfig()

      expect(config.allow_registration).toBe(true)
      expect(config.plugin_install_enabled).toBe(false)
      expect(config.plugin_catalog_enabled).toBe(false)
    })
  })

  describe('isRegistrationEnabled', () => {
    it('returns true when config allows registration', async () => {
      getMock.mockResolvedValueOnce({
        allow_registration: true,
        plugin_install_enabled: true,
        plugin_catalog_enabled: true,
      })

      const enabled = await isRegistrationEnabled()

      expect(enabled).toBe(true)
    })

    it('returns false when config disallows registration', async () => {
      getMock.mockResolvedValueOnce({
        allow_registration: false,
        plugin_install_enabled: true,
        plugin_catalog_enabled: true,
      })

      const enabled = await isRegistrationEnabled()

      expect(enabled).toBe(false)
    })
  })
})