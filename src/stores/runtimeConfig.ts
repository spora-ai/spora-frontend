import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { log } from '@/utils/logger'
import type { ApiConfig } from '@/types/auth'

/**
 * useRuntimeConfigStore — single source of runtime feature flags for the SPA.
 *
 * The router guard (`src/router/index.ts`) calls `init()` on first
 * navigation per page session. A hard browser reload creates a new
 * Pinia store, so `/api/v1/config` is re-fetched on every reload — by
 * design. No module-level cache survives a reload.
 *
 * `init()` itself dedupes concurrent callers via `initPromise` (same
 * pattern as `useAuthStore.init()`), so it's safe to call from multiple
 * places in quick succession.
 *
 * Fail-CLOSED vs fail-OPEN asymmetry:
 *   - allow_registration     fails OPEN (registration is safe to attempt)
 *   - allow_group_creation   fails OPEN (UI is just an affordance — the
 *                            server enforces the gate via route middleware)
 *   - plugin_install_enabled fails CLOSED (admin gate; safer default)
 *   - plugin_catalog_enabled fails CLOSED (admin gate; safer default)
 *
 * `initialized` becomes `true` even on failure so the router guard
 * stops blocking. Callers that need to know whether the network call
 * succeeded should check `initError` instead of `initialized`.
 */
export const useRuntimeConfigStore = defineStore('runtimeConfig', () => {
  // Default: allow_registration=true and allow_group_creation=true (matches
  // config.php#allow_group_creation default + auth.ts:36 fail-open). The
  // admin-gate flags default to false until the network call resolves.
  const allowRegistration = ref<boolean>(true)
  const allowGroupCreation = ref<boolean>(true)
  const pluginInstallEnabled = ref<boolean>(false)
  const pluginCatalogEnabled = ref<boolean>(false)
  const initialized = ref<boolean>(false)
  const initError = ref<Error | null>(null)

  let initPromise: Promise<void> | null = null

  /** Map a FeatureFlag key to the corresponding reactive boolean. */
  function flagFor(flag: 'plugin_install' | 'plugin_catalog'): boolean {
    return flag === 'plugin_install' ? pluginInstallEnabled.value : pluginCatalogEnabled.value
  }

  /** Called once on app boot / per reload by the router guard. */
  function init(): Promise<void> {
    if (initPromise !== null) return initPromise

    initPromise = (async () => {
      try {
        initError.value = null
        const res = await api.get<ApiConfig>('/config')
        allowRegistration.value = !!res.allow_registration
        allowGroupCreation.value = !!res.allow_group_creation
        pluginInstallEnabled.value = !!res.plugin_install_enabled
        pluginCatalogEnabled.value = !!res.plugin_catalog_enabled
      } catch (e) {
        // Reset to safe defaults on failure — see header for the asymmetry.
        allowRegistration.value = true
        allowGroupCreation.value = true
        pluginInstallEnabled.value = false
        pluginCatalogEnabled.value = false
        initError.value = e instanceof Error ? e : new Error(String(e))
        log.warn('[runtimeConfig] /config unreachable; admin gates closed, public gates open', e)
      } finally {
        initialized.value = true
        if (initError.value !== null) {
          // Allow the next page reload to retry the fetch.
          initPromise = null
        }
      }
    })()

    return initPromise
  }

  const isReady = computed<boolean>(() => initialized.value)
  const hasInitError = computed<boolean>(() => initError.value !== null)

  return {
    allowRegistration,
    allowGroupCreation,
    pluginInstallEnabled,
    pluginCatalogEnabled,
    initialized,
    initError,
    isReady,
    hasInitError,
    flagFor,
    init,
  }
})