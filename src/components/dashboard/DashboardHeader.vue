<script setup lang="ts">
/**
 * DashboardHeader — page header strip: title + agent count + Refresh
 * button + "New agent" CTA.
 *
 * Owns two side-effects:
 *   1. Refresh button → `useDashboardData().refresh()` (disabled while
 *      `isRefreshing` so a double-click can't double-fire the fetch).
 *   2. "+ New agent" → `useCreateAgentDialogStore().open('choice')`,
 *      which surfaces the unified create-agent picker rendered once at
 *      the app root.
 */
import { useDashboardData } from '@/composables/useDashboardData'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'

const { agents, isRefreshing, refresh } = useDashboardData()
const createDialog = useCreateAgentDialogStore()

function onRefresh(): void {
  void refresh()
}

function onNewAgent(): void {
  createDialog.open('choice')
}
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="flex flex-col">
      <h1 class="header-title m-0 text-2xl font-semibold tracking-tight text-foreground">
        Agents
      </h1>
      <p class="header-subtitle mt-1 text-sm text-muted-foreground">
        {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}
        <span class="header-hint text-muted-foreground">&middot; click a KPI or chip to filter</span>
      </p>
    </div>
    <div class="header-actions flex items-center gap-2">
      <button
        type="button"
        class="refresh-btn inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="isRefreshing"
        :aria-label="isRefreshing ? 'Refreshing' : 'Refresh'"
        @click="onRefresh"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        {{ isRefreshing ? 'Refreshing…' : 'Refresh' }}
      </button>
      <button
        type="button"
        class="new-agent-btn inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="onNewAgent"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4v16m8-8H4" />
        </svg>
        New agent
      </button>
    </div>
  </header>
</template>
