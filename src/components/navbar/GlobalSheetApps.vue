<script setup lang="ts">
/**
 * GlobalSheetApps — apps grid in the navbar sheet. Mirrors the
 * behaviour of the old apps dropdown: lazy-loads `GET /apps` on
 * first mount, then renders a 2×2 grid of app tiles. Empty state
 * shows "No apps installed"; an API failure clears the list
 * silently (the apps grid is a convenience surface, not a source
 * of truth).
 *
 * Each tile's gradient is driven by the server-supplied `app.accent`
 * token (see `AppResource.accent`). The token → Tailwind class map
 * lives in `tileAccent()` and mirrors the `accent` enum in
 * `spora-core/plugin.schema.json` — keep both in sync when adding
 * colours. Unknown / future tokens fall back to `"primary"`, the
 * same default AppsController uses server-side.
 *
 * Each tile routes to the app's resource route on click. The
 * orchestrator wires the navigation event so it can also close the
 * sheet in the same tick.
 */
import { onMounted, ref } from 'vue'
import { api } from '@/api/client'
import Icon from '@/components/ui/Icon.vue'
import type { AppAccent, AppResource } from '@/apps/types'

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

/**
 * Token → Tailwind class map. Each token corresponds to a gradient +
 * text colour pair the tile renders with. The Tailwind classes are
 * inlined rather than driven by a safelist because the palette is
 * short and fixed — adding a token here without updating the schema
 * enum (and vice versa) is the documented contract change in
 * `spora-docs/docs/develop/plugins/author-guide/admin-ui.md`.
 */
const ACCENT_CLASSES: Record<AppAccent, string> = {
  violet: 'from-violet-500/20 to-violet-500/5 text-violet-700 dark:text-violet-300',
  amber: 'from-amber-500/20 to-amber-500/5 text-amber-700 dark:text-amber-300',
  emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  sky: 'from-sky-500/20 to-sky-500/5 text-sky-700 dark:text-sky-300',
  rose: 'from-rose-500/20 to-rose-500/5 text-rose-700 dark:text-rose-300',
  primary: 'from-primary/20 to-primary/5 text-primary',
}

function tileAccent(accent: AppAccent | string | undefined): string {
  // Defensive: if a future server payload adds an unrecognised token
  // (or the field is missing), fall back to the schema's default
  // token. Keeps the SPA renderable even if the backend gets ahead
  // of the frontend — AppsController already does the same fallback
  // server-side, this just makes the SPA tolerant of in-flight
  // deployments.
  return ACCENT_CLASSES[(accent ?? 'primary') as AppAccent] ?? ACCENT_CLASSES.primary
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
        :class="tileAccent(app.accent)"
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
