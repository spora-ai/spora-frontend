/**
 * useFeatureEnabled — minimal feature-flag composable for the Web UI plugin
 * install surface. Defaults to enabled; reads VITE_FEATURE_PLUGIN_INSTALL
 * at build time via import.meta.env.
 */
import { describe, it, expect } from 'vitest'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'

describe('useFeatureEnabled', () => {
  it('defaults to true when no VITE_FEATURE_* env var is set', () => {
    const flag = useFeatureEnabled('plugin_install')
    expect(flag.value).toBe(true)
  })

  it('returns false when VITE_FEATURE_PLUGIN_INSTALL="false"', () => {
    vi.stubEnv('VITE_FEATURE_PLUGIN_INSTALL', 'false')
    try {
      const flag = useFeatureEnabled('plugin_install')
      expect(flag.value).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})