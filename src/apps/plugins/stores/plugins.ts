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
 *
 * Mutations are pure: they call the API, set `lastResult` + `error`, and
 * rethrow on failure. The mutation owns the `error` ref only — `load()`
 * writes its own failure into `error` but is never called from inside a
 * mutation, so an inventory reload failure can never masquerade as an
 * install failure. **Callers must `store.load()` themselves** after a
 * successful mutation (e.g. the page-level modal runs `load()` from its
 * `@installed` handler).
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

  /** Install a plugin by Composer vendor/name. Throws on failure. Caller reloads. */
  async function install(req: PluginInstallRequest): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiInstall(req)
      lastResult.value = result
      return result
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Install failed.'
      throw e
    } finally {
      mutating.value = false
    }
  }

  /** Uninstall a plugin by Composer package name. Throws on failure. Caller reloads. */
  async function uninstall(pkg: string): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUninstall(pkg)
      lastResult.value = result
      return result
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Uninstall failed.'
      throw e
    } finally {
      mutating.value = false
    }
  }

  /** Re-pin a plugin by Composer package name (constraint optional). Throws on failure. Caller reloads. */
  async function update(
    pkg: string,
    req: PluginUpdateRequest = {},
  ): Promise<PluginOperationResult> {
    mutating.value = true
    error.value = null
    try {
      const result = await apiUpdate(pkg, req)
      lastResult.value = result
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