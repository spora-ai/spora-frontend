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
  <header class="dashboard-header">
    <div class="header-titles">
      <h1 class="header-title">Agents</h1>
      <p class="header-subtitle">
        {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}
        <span class="header-hint">&middot; click a KPI or chip to filter</span>
      </p>
    </div>
    <div class="header-actions">
      <button
        type="button"
        class="refresh-btn"
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
        class="new-agent-btn"
        @click="onNewAgent"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 4v16m8-8H4" />
        </svg>
        New agent
      </button>
    </div>
  </header>
</template>

<style scoped>
.dashboard-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.header-titles {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: hsl(var(--foreground));
  margin: 0;
}

.header-subtitle {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

.header-hint {
  color: hsl(var(--muted-foreground));
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.refresh-btn,
.new-agent-btn {
  display: inline-flex;
  height: 2.25rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 150ms ease, opacity 150ms ease;
}

.refresh-btn {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.refresh-btn:hover {
  background: hsl(var(--muted));
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.new-agent-btn {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.new-agent-btn:hover {
  opacity: 0.9;
}
</style>
