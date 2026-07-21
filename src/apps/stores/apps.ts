import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/api/client'
import type { AppResource } from '../types'

/**
 * Registry of plugin-supplied admin apps discovered via `GET /api/v1/apps`.
 * Drives the Apps dropdown and resolves `/apps/:appName` to a plugin slug
 * + `frontendEntry` for dynamic mount. Apps without a `frontendEntry`
 * (the only remaining core-owned app is `plugins`) stay in the registry
 * purposes but are filtered out of `mountableApps`.
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
      // Keep the cached promise on success so re-mounts in the same tick
      // share it; clear on failure so the next call retries.
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
