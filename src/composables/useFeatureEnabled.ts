import { computed, type ComputedRef } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

/**
 * useFeatureEnabled — reactive boolean for a runtime feature flag.
 *
 * Reads from `useRuntimeConfigStore()`, which fetches `GET /api/v1/config`
 * on every page reload via the router guard. Returns `false` whenever the
 * store hasn't finished its initial fetch, so callers never see a stale
 * "true" default before the server has been consulted.
 *
 * The server is the source of truth. The previous build-time
 * `import.meta.env.VITE_FEATURE_*` path was removed because its default
 * (`true`) silently diverged from the server's default (`false`) on the
 * `plugin_install_enabled` flag — see spora-frontend PR for context.
 */
export type FeatureFlag = 'plugin_install' | 'plugin_catalog'

export function useFeatureEnabled(flag: FeatureFlag): ComputedRef<boolean> {
  return computed(() => {
    const s = useRuntimeConfigStore()
    return s.initialized ? s.flagFor(flag) : false
  })
}