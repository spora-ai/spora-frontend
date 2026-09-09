import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import type { ApiConfig } from '@/types/auth'

/**
 * Authentication utilities for config fetching and route guards.
 *
 * Runtime feature flags are owned by `useRuntimeConfigStore` and re-fetched
 * on every page reload (the SPA hits `GET /api/v1/config` via
 * `useRuntimeConfigStore.init()` from the router guard). Caching across
 * reloads would silently diverge from server state.
 */

/**
 * Fetch public app config from `GET /api/v1/config`.
 *
 * Returns the unwrapped `ApiConfig` payload. Awaits the store's
 * `init()` so the call is deduped across concurrent callers.
 */
export async function fetchConfig(): Promise<ApiConfig> {
  const store = useRuntimeConfigStore()
  await store.init()
  return {
    allow_registration: store.allowRegistration,
    allow_group_creation: store.allowGroupCreation,
    plugin_install_enabled: store.pluginInstallEnabled,
    plugin_catalog_enabled: store.pluginCatalogEnabled,
  }
}

/**
 * Check whether registration is enabled.
 *
 * Awaits the runtime store's `init()` so the call site doesn't need to
 * know about caching. Used by the `/register` route guard beforeEnter
 * (`src/router/index.ts:19-23`).
 */
export async function isRegistrationEnabled(): Promise<boolean> {
  const store = useRuntimeConfigStore()
  await store.init()
  return store.allowRegistration
}