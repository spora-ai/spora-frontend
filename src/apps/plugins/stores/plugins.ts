import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@/api/client'
import type {
  PluginInstallRequest,
  PluginOperationResult,
  PluginResource,
  PluginUpdateRequest,
} from '../types/plugin'
import {
  getPlugins,
  installPlugin as apiInstall,
  uninstallPlugin as apiUninstall,
  updatePlugin as apiUpdate,
} from '../api/plugins'

/**
 * Inventory + install state for the /apps/plugins page.
 *
 * `load()` fetches the read-only inventory. The mutating actions
 * (`install`, `uninstall`, `update`) hit the admin-gated endpoints
 * added in v0.6.2 — the backend enforces Spora_PLUGIN_INSTALL_ENABLED,
 * admin role, and CSRF. The UI hides the buttons when the feature
 * is off (via `useFeatureEnabled('plugin_install')`) but the server
 * remains authoritative.
 *
 * On success, the store reloads the inventory so the new state shows up
 * without the caller needing to call `load()` manually.
 */
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginResource[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const mutating = ref(false)
  const lastResult = ref<PluginOperationResult | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      plugins.value = await getPlugins()
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load plugins.'
    } finally {
      loading.value = false
    }
  }

  async function install(req: PluginInstallRequest): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiInstall(req)
      lastResult.value = result
      await load()
      return result
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Install failed.'
      throw e
    } finally {
      mutating.value = false
    }
  }

  async function uninstall(packageName: string): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUninstall(packageName)
      lastResult.value = result
      await load()
      return result
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Uninstall failed.'
      throw e
    } finally {
      mutating.value = false
    }
  }

  async function update(
    packageName: string,
    req: PluginUpdateRequest = {},
  ): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUpdate(packageName, req)
      lastResult.value = result
      await load()
      return result
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Update failed.'
      throw e
    } finally {
      mutating.value = false
    }
  }

  return {
    plugins,
    loading,
    error,
    mutating,
    lastResult,
    load,
    install,
    uninstall,
    update,
  }
})