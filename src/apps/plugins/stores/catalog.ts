import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@/api/client'
import type { CatalogEntry } from '../types/plugin'
import { getCatalog } from '../api/plugins'

/**
 * Browse-tab catalog store. Backed by Packagist via the
 * `GET /api/v1/plugins/catalog` endpoint (see
 * `spora-core/docs/20_plugin_install_api.md` and the v0.7.0 catalog PR).
 *
 * The store doesn't debounce search input itself — the panel owner
 * (BrowseStorePanel) wraps `search()` calls in a 300 ms debounce so
 * the keystroke-to-keystroke rate is bounded. Cache metadata
 * (`cached_at`, `ttl_seconds`) is exposed for the "cached 12 min ago"
 * badge in the panel.
 */
export const useCatalogStore = defineStore('plugin-catalog', () => {
  const packages = ref<CatalogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const query = ref('')
  const cachedAt = ref<number | null>(null)
  const ttlSeconds = ref(3600)

  function clearError(): void {
    error.value = null
  }

  async function search(q: string): Promise<void> {
    const trimmed = q.trim()
    query.value = trimmed
    loading.value = true
    error.value = null
    try {
      const response = await getCatalog(trimmed)
      packages.value = response.packages
      cachedAt.value = response.cached_at || null
      ttlSeconds.value = response.ttl_seconds || 3600
    } catch (e) {
      packages.value = []
      cachedAt.value = null
      error.value = e instanceof ApiError ? e.message : 'Failed to load catalog.'
    } finally {
      loading.value = false
    }
  }

  return {
    packages,
    loading,
    error,
    query,
    cachedAt,
    ttlSeconds,
    search,
    clearError,
  }
})