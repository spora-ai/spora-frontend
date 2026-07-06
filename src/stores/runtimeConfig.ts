import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { log } from '@/utils/logger'
import type { ApiConfig } from '@/types/auth'

/**
 * useRuntimeConfigStore — single source of runtime feature flags for the SPA.
 *
 * Mirrors `useAuthStore.init()`'s initPromise dedupe so concurrent callers
 * share a single fetch. The router guard (`src/router/index.ts`) calls
 * `init()` before each navigation, which means a hard reload re-fetches
 * `/api/v1/config` — by design. No module-level cache survives a reload.
 *
 * Fail-CLOSED vs fail-OPEN asymmetry:
 *   - allow_registration     fails OPEN (registration is safe to attempt)
 *   - plugin_install_enabled fails CLOSED (admin gate; safer default)
 *   - plugin_catalog_enabled fails CLOSED (admin gate; safer default)
 *
 * `initialized` becomes `true` even on failure so the router guard
 * stops blocking. Callers that need to know whether the network call
 * succeeded should check `initError` instead of `initialized`.
 */
export const useRuntimeConfigStore = defineStore('runtimeConfig', () => {
  // Default: allow_registration=true (matches auth.ts:36 fail-open).
  // The two admin-gate flags default to false until the network call resolves.
  const allowRegistration = ref<boolean>(true)
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
        pluginInstallEnabled.value = !!res.plugin_install_enabled
        pluginCatalogEnabled.value = !!res.plugin_catalog_enabled
      } catch (e) {
        // Reset to safe defaults on failure — see header for the asymmetry.
        allowRegistration.value = true
        pluginInstallEnabled.value = false
        pluginCatalogEnabled.value = false
        initError.value = e instanceof Error ? e : new Error(String(e))
        log.warn('[runtimeConfig] /config unreachable; admin gates closed, allow_registration open', e)
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