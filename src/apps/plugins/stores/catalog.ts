import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError } from '@/api/client'
import type { CatalogEntry } from '../types/plugin'
import { getCatalog } from '../api/plugins'

/**
 * useCatalogStore — Browse tab Packagist catalog state. Backed by
 * `GET /api/v1/plugins/catalog`; the panel handles input debouncing.
 */
export const useCatalogStore = defineStore('plugin-catalog', () => {
  const packages = ref<CatalogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const query = ref('')
  const cachedAt = ref<number | null>(null)
  const ttlSeconds = ref(3600)

  /** Reset the error banner without touching the cached result. */
  function clearError(): void {
    error.value = null
  }

  /** Fetch the catalog for `q` (trimmed). Replaces `packages` on success,
   *  clears them on failure, and always resets `loading` in the end. */
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