import { api } from '@/api/client'
import type {
  PluginInstallRequest,
  PluginOperationResult,
  PluginResource,
  PluginUpdateRequest,
} from '../types/plugin'

/**
 * Plugin API client. Read-only inventory lives in `getPlugins()`; the
 * mutating endpoints (install / uninstall / update) require admin + CSRF
 * and are gated on SPORA_PLUGIN_INSTALL_ENABLED server-side. When the
 * feature is off, the backend returns `403 FEATURE_DISABLED` which the
 * UI surfaces as `ApiError(code='FEATURE_DISABLED')`.
 */

/** GET /plugins — returns the inventory surfaced on /apps/plugins. */
export async function getPlugins(): Promise<PluginResource[]> {
  const result = await api.get<{ plugins: PluginResource[] }>('/plugins')
  return result.plugins
}

/** POST /plugins — install a Composer vendor/name; optional `constraint` pins the version. */
export async function installPlugin(req: PluginInstallRequest): Promise<PluginOperationResult> {
  const result = await api.post<{ data: PluginOperationResult }>('/plugins', req)
  return result.data
}

/** DELETE /plugins/{slug} — remove a plugin by slug. */
export async function uninstallPlugin(slug: string): Promise<PluginOperationResult> {
  const result = await api.delete<{ data: PluginOperationResult }>(
    `/plugins/${encodeURIComponent(slug)}`,
  )
  return result.data
}

/** PATCH /plugins/{slug} — re-pin a plugin to a new constraint (omit to keep current). */
export async function updatePlugin(
  slug: string,
  req: PluginUpdateRequest = {},
): Promise<PluginOperationResult> {
  const result = await api.patch<{ data: PluginOperationResult }>(
    `/plugins/${encodeURIComponent(slug)}`,
    req,
  )
  return result.data
}