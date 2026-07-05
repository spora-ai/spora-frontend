<script setup lang="ts">
/**
 * CatalogCard — a single Packagist entry on the Browse tab.
 *
 * In v0.7.0 ships without an in-card Install button; that wires up to
 * the install endpoint in spora-frontend#24 (A4). Until A4 lands the
 * card is a discoverability surface (Packagist link + copy-to-CLI).
 */
import { Check, Clipboard, ExternalLink } from 'lucide-vue-next'
import { onUnmounted, ref } from 'vue'
import type { CatalogEntry } from '../types/plugin'

const props = defineProps<{
  entry: CatalogEntry
}>()

const copied = ref(false)
let resetHandle: ReturnType<typeof setTimeout> | null = null

async function copyPackage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(props.entry.name)
      copied.value = true
      // Clear any in-flight reset from a prior click — otherwise a rapid
      // double-click can flip the label back to "Copy name" too early.
      if (resetHandle !== null) {
        clearTimeout(resetHandle)
      }
      resetHandle = setTimeout(() => {
        copied.value = false
        resetHandle = null
      }, 1500)
    }
  } catch {
    // Clipboard unavailable (insecure context, no permission) — silently ignore.
  }
}

onUnmounted(() => {
  if (resetHandle !== null) {
    clearTimeout(resetHandle)
    resetHandle = null
  }
})
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