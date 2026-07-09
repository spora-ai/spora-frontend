import { api } from '@/api/client'
import type {
  CatalogResponse,
  PluginInstallRequest,
  PluginOperationResult,
  PluginResource,
  PluginUpdateRequest,
} from '../types/plugin'

/**
 * Plugin API client. Read-only inventory lives in `getPlugins()`; the
 * mutating endpoints (install / uninstall / update) require admin + CSRF
 * and are gated on `SPORA_PLUGIN_INSTALL_ENABLED` server-side. When that
 * feature is off the backend returns `403 FEATURE_DISABLED` which the UI
 * surfaces as `ApiError(code='FEATURE_DISABLED')`.
 *
 * The api client at `@/api/client.ts` auto-unwraps `{data: ...}` envelopes
 * via `body.data ?? body`, so these functions return the inner object
 * directly. Do not add a second `.data` access — it would return
 * `undefined` and crash the caller's `result.package`.
 */

/** GET /plugins — returns the inventory surfaced on /apps/plugins. */
export async function getPlugins(): Promise<PluginResource[]> {
  const result = await api.get<{ plugins: PluginResource[] }>('/plugins')
  return result.plugins
}

/** POST /plugins — install a Composer vendor/name; optional `constraint` pins the version. */
export async function installPlugin(req: PluginInstallRequest): Promise<PluginOperationResult> {
  return api.post<PluginOperationResult>('/plugins', req)
}

/**
 * DELETE /plugins/{package} — remove a plugin by Composer package name.
 * `pkg` MUST be the Composer `vendor/name` (e.g. `spora-ai/spora-plugin-tavily`),
 * NOT the plugin slug — the server validates the path segment against a
 * vendor/name regex. The slug-to-package mapping lives on `PluginResource.package`.
 */
export async function uninstallPlugin(pkg: string): Promise<PluginOperationResult> {
  return api.delete<PluginOperationResult>(`/plugins/${encodeURIComponent(pkg)}`)
}

/**
 * PATCH /plugins/{package} — re-pin a plugin to a new constraint
 * (omit `req.constraint` to keep current). `pkg` MUST be the Composer
 * `vendor/name` — see `uninstallPlugin` for the same constraint.
 */
export async function updatePlugin(
  pkg: string,
  req: PluginUpdateRequest = {},
): Promise<PluginOperationResult> {
  return api.patch<PluginOperationResult>(
    `/plugins/${encodeURIComponent(pkg)}`,
    req,
  )
}

/**
 * Fetch the Packagist-backed plugin catalog. Empty query lists every
 * `type=spora-plugin` package; non-empty query is a free-text search
 * (Packagist's `q` param). Returns the unwrapped `{packages, cached_at,
 * ttl_seconds}` envelope.
 *
 * When the server's `SPORA_PLUGIN_CATALOG_ENABLED` is off the route
 * returns 404; the caller receives an `ApiError(404)` and renders the
 * existing error banner. The UI does not yet hide the Browse tab via a
 * client-side feature flag.
 */
export async function getCatalog(query: string): Promise<CatalogResponse> {
  const params = new URLSearchParams({ q: query })
  return api.get<CatalogResponse>(`/plugins/catalog?${params.toString()}`)
}