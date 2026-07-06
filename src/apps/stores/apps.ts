import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/api/client'
import type { AppResource } from '../types'

/**
 * Registry of plugin-supplied admin apps discovered via `GET /api/v1/apps`.
 * The GlobalNavbar reads this for the Apps dropdown; `PluginAppPage` reads it
 * to resolve the matched `/apps/:appName` segment to a plugin slug +
 * `frontendEntry` for the dynamic mount.
 *
 * Apps whose entry lacks `frontendEntry` (i.e. "core-owned" — memories,
 * plugins) are still listed here for dropdown purposes, but `resolveApp()`
 * filters them out for the `mountPlugin()` call (back-compat with the
 * legacy hard-coded routes).
 */
export const useAppsStore = defineStore('apps', () => {
  const apps = ref<AppResource[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Cached so multiple components asking on the same tick don't double-fetch. */
  let loadPromise: Promise<void> | null = null

  async function load(force = false): Promise<void> {
    if (!force && loadPromise !== null) {
      return loadPromise
    }
    loading.value = true
    error.value = null
    loadPromise = (async () => {
      try {
        const result = await api.get<{ apps: AppResource[] }>('/apps')
        apps.value = result.apps
      } catch (e) {
        error.value = e instanceof ApiError ? e.message : 'Failed to load apps.'
        apps.value = []
      } finally {
        loading.value = false
      }
    })()
    try {
      await loadPromise
    } finally {
      // Don't clear on success so the cached promise catches re-mounts during
      // the same tick. Only clear on failure so a later retry can re-run.
      if (error.value !== null) {
        loadPromise = null
      }
    }
  }

  /** Resolve a route segment (e.g. the URL `/apps/media-archive`) to an app entry. */
  function resolveApp(name: string): AppResource | null {
    return apps.value.find(a => a.name === name) ?? null
  }

  /**
   * Apps with a frontend bundle (i.e. the `mountPlugin()` dispatch path).
   * Excludes core-owned apps that still use the legacy hard-coded children.
   */
  const mountableApps = computed(() =>
    apps.value.filter((a): a is AppResource & { frontendEntry: string; slug: string } =>
      typeof a.frontendEntry === 'string'
      && typeof a.slug === 'string',
    ),
  )

  return {
    apps,
    loading,
    error,
    mountableApps,
    load,
    resolveApp,
  }
})
