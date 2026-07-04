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
 * and are gated on Spora_PLUGIN_INSTALL_ENABLED server-side. When the
 * feature is off, the backend returns `403 FEATURE_DISABLED` which the
 * UI surfaces as `ApiError(code='FEATURE_DISABLED')`.
 */
export async function getPlugins(): Promise<PluginResource[]> {
  const result = await api.get<{ plugins: PluginResource[] }>('/plugins')
  return result.plugins
}

export async function installPlugin(req: PluginInstallRequest): Promise<PluginOperationResult> {
  const result = await api.post<{ data: PluginOperationResult }>('/plugins', req)
  return result.data
}

export async function uninstallPlugin(packageName: string): Promise<PluginOperationResult> {
  const result = await api.delete<{ data: PluginOperationResult }>(
    `/plugins/${encodeURIComponent(packageName)}`,
  )
  return result.data
}

export async function updatePlugin(
  packageName: string,
  req: PluginUpdateRequest = {},
): Promise<PluginOperationResult> {
  const result = await api.patch<{ data: PluginOperationResult }>(
    `/plugins/${encodeURIComponent(packageName)}`,
    req,
  )
  return result.data
}