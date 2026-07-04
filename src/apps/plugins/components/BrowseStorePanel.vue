<script setup lang="ts">
/**
 * BrowseStorePanel — the Browse tab body.
 *
 * Owns the search input, debounce timer, and the grid of CatalogCards.
 * Emits `installed` so the parent page can switch to the Installed
 * tab and refresh the inventory.
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { useCatalogStore } from '../stores/catalog'
import CatalogCard from './CatalogCard.vue'

const emit = defineEmits<{
  installed: []
}>()

const catalogStore = useCatalogStore()
const searchInput = ref(catalogStore.query)

const DEBOUNCE_MS = 300
let debounceHandle: ReturnType<typeof setTimeout> | null = null

function scheduleSearch(value: string): void {
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle)
  }
  debounceHandle = setTimeout(() => {
    void catalogStore.search(value)
  }, DEBOUNCE_MS)
}

function clearSearch(): void {
  searchInput.value = ''
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle)
    debounceHandle = null
  }
  void catalogStore.search('')
}

watch(searchInput, (value) => {
  scheduleSearch(value)
})

onMounted(() => {
  // Initial load — if we have a cached query, re-use it; otherwise list everything.
  if (catalogStore.packages.length === 0) {
    void catalogStore.search(catalogStore.query)
  }
})

onUnmounted(() => {
  if (debounceHandle !== null) {
    clearTimeout(debounceHandle)
  }
})

function onInstalled(): void {
  emit('installed')
}
</script>

<template>
  <div data-testid="browse-store-panel" class="space-y-4">
    <div class="relative">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input
        v-model="searchInput"
        type="search"
        placeholder="Search Packagist for Spora plugins…"
        data-testid="catalog-search-input"
        class="w-full h-10 pl-9 pr-9 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <button
        v-if="searchInput"
        type="button"
        @click="clearSearch"
        class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Clear search"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <div
      v-if="catalogStore.cachedAt"
      class="text-xs text-muted-foreground"
      :title="`Cached at ${new Date(catalogStore.cachedAt * 1000).toISOString()}; TTL ${catalogStore.ttlSeconds}s`"
      data-testid="catalog-cache-age"
    >
      Cached {{ Math.max(0, Math.floor((Date.now() / 1000 - catalogStore.cachedAt) / 60)) }} min ago
    </div>

    <div
      v-if="catalogStore.error"
      class="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm p-4"
      data-testid="catalog-error"
    >
      {{ catalogStore.error }}
    </div>

    <div v-else-if="catalogStore.loading && catalogStore.packages.length === 0" class="text-sm text-muted-foreground">
      Loading catalog…
    </div>

    <div
      v-else-if="catalogStore.packages.length === 0"
      class="rounded-xl border border-dashed border-border bg-card p-12 text-center"
    >
      <Search class="w-10 h-10 text-muted-foreground mx-auto mb-3" />
      <h2 class="text-sm font-semibold mb-1">No plugins found</h2>
      <p class="text-xs text-muted-foreground max-w-md mx-auto">
        Try a different search term, or browse all Spora plugins on
        <a
          href="https://packagist.org/search/?keywords=spora-plugin"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >Packagist</a>.
      </p>
    </div>

    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <CatalogCard
        v-for="entry in catalogStore.packages"
        :key="entry.name"
        :entry="entry"
        @installed="onInstalled"
      />
    </div>
  </div>
</template>