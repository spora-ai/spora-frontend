<script setup lang="ts">
/**
 * CatalogCard — a single Packagist entry on the Browse tab.
 *
 * An admin (with `SPORA_PLUGIN_INSTALL_ENABLED=true`) sees an Install button
 * in the footer that emits `install` with the package name; the parent
 * (`BrowseStorePanel` → `PluginsPage`) opens the page-level install modal
 * pre-filled and locked to that package. Non-admin / feature-flag-off users
 * see only the Packagist link — discoverability is preserved without
 * promising an action they cannot perform.
 */
import { Download, ExternalLink } from 'lucide-vue-next'
import type { CatalogEntry } from '../types/plugin'

defineProps<{
  entry: CatalogEntry
  /** When true (admin + feature flag), render the Install affordance. */
  showInstallButton: boolean
}>()

const emit = defineEmits<{
  install: [pkg: string]
}>()
</script>

<template>
  <div
    :data-testid="`catalog-card-${entry.name}`"
    class="rounded-xl border border-border bg-card p-5 flex flex-col gap-3"
  >
    <div class="flex items-start gap-3">
      <div class="rounded-lg bg-primary/10 p-2 shrink-0">
        <ExternalLink class="w-5 h-5 text-primary" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold truncate font-mono">{{ entry.name }}</h3>
        <p v-if="entry.version" class="text-xs font-mono text-muted-foreground">
          {{ entry.version }}
        </p>
      </div>
    </div>

    <p class="text-xs text-muted-foreground line-clamp-3 min-h-[3rem]">
      {{ entry.description || 'No description provided.' }}
    </p>

    <div v-if="entry.downloads > 0 || entry.favorites > 0" class="flex items-center gap-3 text-xs text-muted-foreground">
      <span v-if="entry.downloads > 0" :title="`${entry.downloads} total Packagist downloads`">
        ↓ {{ entry.downloads.toLocaleString() }}
      </span>
      <span v-if="entry.favorites > 0" :title="`${entry.favorites} Packagist stargazers`">
        ★ {{ entry.favorites.toLocaleString() }}
      </span>
    </div>

    <div class="mt-auto pt-3 border-t border-border flex items-center justify-between gap-2">
      <a
        :href="`https://packagist.org/packages/${entry.name}`"
        target="_blank"
        rel="noopener noreferrer"
        :data-testid="`packagist-${entry.name}`"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink class="w-3 h-3" />
        Packagist
      </a>
      <button
        v-if="showInstallButton"
        type="button"
        :data-testid="`install-${entry.name}`"
        @click="emit('install', entry.name)"
        class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Download class="w-3 h-3" />
        Install
      </button>
    </div>
  </div>
</template>
