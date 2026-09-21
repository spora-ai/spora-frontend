<script setup lang="ts">
/**
 * GlobalSheetApps — apps grid in the navbar sheet. Mirrors the
 * behaviour of the old apps dropdown: lazy-loads `GET /apps` on
 * first mount, then renders a 2×2 grid of app tiles. Empty state
 * shows "No apps installed"; an API failure clears the list
 * silently (the apps grid is a convenience surface, not a source
 * of truth).
 *
 * Each tile routes to the app's resource route on click. The
 * orchestrator wires the navigation event so it can also close
 * the sheet in the same tick.
 */
import { onMounted, ref } from 'vue'
import { api } from '@/api/client'
import type { AppResource } from '@/apps/types'
import Icon from '@/components/ui/Icon.vue'

const emit = defineEmits<{ navigate: [app: AppResource] }>()

const apps = ref<AppResource[]>([])
const loading = ref(false)

async function loadApps(): Promise<void> {
  loading.value = true
  try {
    const result = await api.get<{ apps: AppResource[] }>('/apps')
    apps.value = result.apps
  } catch {
    // Non-fatal — the apps grid is a convenience surface. A future
    // mount (e.g. after a plugin install) will retry the fetch.
    apps.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadApps)

function onClick(app: AppResource): void {
  emit('navigate', app)
}

// Stable accent colour per app — kept inline rather than driven by
// a Tailwind safelist so unused classes don't ship in the bundle.
// The list is short and fixed; an `apps.config` map would be
// premature for this size.
function tileAccent(name: string): string {
  switch (name) {
    case 'plugins':
      return 'from-violet-500/20 to-violet-500/5 text-violet-700 dark:text-violet-300'
    case 'media-archive':
      return 'from-amber-500/20 to-amber-500/5 text-amber-700 dark:text-amber-300'
    case 'memories':
      return 'from-emerald-500/20 to-emerald-500/5 text-emerald-700 dark:text-emerald-300'
    case 'typst':
      return 'from-sky-500/20 to-sky-500/5 text-sky-700 dark:text-sky-300'
    default:
      return 'from-primary/20 to-primary/5 text-primary'
  }
}
</script>

<template>
  <section class="px-5 py-4">
    <h2 class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
      Apps
    </h2>
    <div
      v-if="apps.length > 0"
      class="grid grid-cols-2 gap-2"
    >
      <button
        v-for="app in apps"
        :key="app.name"
        type="button"
        class="flex flex-col items-start gap-2 p-3 rounded-xl border border-border bg-gradient-to-br text-left transition-colors hover:border-primary/40"
        :class="tileAccent(app.name)"
        @click="onClick(app)"
      >
        <Icon
          :name="app.icon"
          class="h-5 w-5"
        />
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground truncate">
            {{ app.displayName }}
          </p>
          <p class="text-xs text-muted-foreground line-clamp-2">
            {{ app.description }}
          </p>
        </div>
      </button>
    </div>
    <p
      v-else-if="!loading"
      class="text-sm text-muted-foreground"
    >
      No apps installed
    </p>
  </section>
</template>
