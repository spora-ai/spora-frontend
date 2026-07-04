import { api } from '@/api/client'
import type { CatalogResponse, PluginResource } from '../types/plugin'

/**
 * Plugin API client. Read-only inventory lives in `getPlugins()`; the
 * mutating endpoints (install / uninstall / update) require admin + CSRF
 * and are gated on Spora_PLUGIN_INSTALL_ENABLED server-side. When the
 * feature is off, the backend returns `403 FEATURE_DISABLED` which the
 * UI surfaces as `ApiError(code='FEATURE_DISABLED')`.
 */
export async function getPlugins(): Promise<PluginResource[]> {
  const result = await api.get<{ plugins: PluginResource[] }>('/plugins')
  return result.plugins
}

/**
 * Fetch the Packagist-backed plugin catalog. Empty query lists every
 * `type=spora-plugin` package; non-empty query is a free-text search
 * (Packagist's `q` param). Returns the unwrapped `{packages, cached_at,
 * ttl_seconds}` envelope.
 *
 * When the server's `SPORA_PLUGIN_CATALOG_ENABLED` is off the route
 * returns 404 — the UI hides the Browse tab in that case via the
 * `plugin_catalog` feature flag.
 */
export async function getCatalog(query: string): Promise<CatalogResponse> {
  const params = new URLSearchParams({ q: query })
  return api.get<CatalogResponse>(`/plugins/catalog?${params.toString()}`)
}