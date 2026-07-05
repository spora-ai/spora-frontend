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
 * Inventory + install state for the /apps/plugins page. Mutating actions
 * (install/uninstall/update) are admin-gated; the UI hides the buttons via
 * `useFeatureEnabled('plugin_install')` but the backend remains authoritative.
 * On success, the store reloads the inventory so callers see fresh state.
 */
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginResource[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const mutating = ref(false)
  const lastResult = ref<PluginOperationResult | null>(null)

  /** Fetch the read-only inventory; sets `error` on failure (does not throw). */
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

  /** Install a plugin by Composer vendor/name; reloads inventory on success. Throws on failure. */
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

  /** Uninstall a plugin by slug; reloads inventory on success. Throws on failure. */
  async function uninstall(slug: string): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUninstall(slug)
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

  /** Re-pin a plugin by slug (constraint optional). Reloads on success. Throws on failure. */
  async function update(
    slug: string,
    req: PluginUpdateRequest = {},
  ): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUpdate(slug, req)
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