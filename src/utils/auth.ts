import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import type { ApiConfig } from '@/types/auth'

/**
 * Authentication utilities for config fetching and route guards.
 *
 * The module-level config cache is gone — runtime feature flags must be
 * re-fetched on every page reload (the SPA hits `GET /api/v1/config`
 * via `useRuntimeConfigStore.init()` from the router guard). Caching
 * across reloads would silently diverge from server state.
 *
 * Kept here for back-compat with existing call sites in
 * `src/router/index.ts`, `src/pages/LoginPage.vue`, and the tests that
 * reference `clearConfigCache()`.
 */

/**
 * Clear the cached config. No-op retained for back-compat with tests.
 *
 * With the runtime store in place, the "cache" is the in-memory Pinia
 * store which the router guard re-populates on every navigation; there
 * is no cross-reload cache to clear. Use the store's `$reset()` if a
 * hard reset is needed (tests only).
 */
export function clearConfigCache(): void {
  // No-op: previously reset the module-level `cachedConfig` variable.
  // The store is re-populated on every reload by the router guard.
}

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

/**
 * Get the redirect target for a user trying to access a guest-only route.
 * Redirects authenticated users to the dashboard. Allows unauthenticated users (guests) to stay.
 */
export function getGuestRedirect(authenticated: boolean): string | null {
  return authenticated ? '/dashboard' : null
}