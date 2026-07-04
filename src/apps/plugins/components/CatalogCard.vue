<script setup lang="ts">
/**
 * CatalogCard — single Packagist entry on the Browse tab.
 *
 * v0.7.0 ships the catalog without the per-card Install button — that
 * wires up to the install endpoint in spora-frontend#24 (A4), which
 * isn't merged yet. Once A4 lands, fold in the Install button that
 * calls usePluginsStore().install({package: props.entry.name}).
 *
 * For now the card is a discoverability surface: a Packagist link and
 * a copy-to-clipboard for the package name so operators can paste it
 * into the CLI.
 */
import { Check, Clipboard, ExternalLink } from 'lucide-vue-next'
import { ref } from 'vue'
import type { CatalogEntry } from '../types/plugin'

const props = defineProps<{
  entry: CatalogEntry
}>()

const copied = ref(false)

async function copyPackage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(props.entry.name)
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
    }
  } catch {
    // Clipboard unavailable (insecure context, no permission) — silently ignore.
  }
}
</script>

<template>
  <div
    :data-testid="`catalog-card-${props.entry.name}`"
    class="rounded-xl border border-border bg-card p-5 flex flex-col gap-3"
  >
    <div class="flex items-start gap-3">
      <div class="rounded-lg bg-primary/10 p-2 shrink-0">
        <ExternalLink class="w-5 h-5 text-primary" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold truncate font-mono">{{ props.entry.name }}</h3>
        <p v-if="props.entry.version" class="text-xs font-mono text-muted-foreground">
          {{ props.entry.version }}
        </p>
      </div>
    </div>

    <p class="text-xs text-muted-foreground line-clamp-3 min-h-[3rem]">
      {{ props.entry.description || 'No description provided.' }}
    </p>

    <div v-if="props.entry.downloads > 0 || props.entry.favorites > 0" class="flex items-center gap-3 text-xs text-muted-foreground">
      <span v-if="props.entry.downloads > 0" :title="`${props.entry.downloads} total Packagist downloads`">
        ↓ {{ props.entry.downloads.toLocaleString() }}
      </span>
      <span v-if="props.entry.favorites > 0" :title="`${props.entry.favorites} Packagist stargazers`">
        ★ {{ props.entry.favorites.toLocaleString() }}
      </span>
    </div>

    <div class="mt-auto pt-3 border-t border-border flex items-center justify-between gap-2">
      <a
        :href="`https://packagist.org/packages/${props.entry.name}`"
        target="_blank"
        rel="noopener noreferrer"
        :data-testid="`packagist-${props.entry.name}`"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink class="w-3 h-3" />
        Packagist
      </a>
      <button
        type="button"
        :data-testid="`copy-${props.entry.name}`"
        @click="copyPackage"
        class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Check v-if="copied" class="w-3 h-3 text-green-500" />
        <Clipboard v-else class="w-3 h-3" />
        {{ copied ? 'Copied' : 'Copy name' }}
      </button>
    </div>
  </div>
</template>