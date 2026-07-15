<script setup lang="ts">
/**
 * DashboardPage — the redesigned operator landing.
 *
 * Composes the dashboard subcomponents from Phase 2 and the dashboard state
 * composable (`useDashboardData`) that owns the boot fetch, refresh, KPI
 * derivations, and chip / query / sort filter state. The page itself has
 * no business logic — its only jobs are:
 *   1. Trigger the boot fetch on mount.
 *   2. Render the navbar + header + KPI strip + toolbar + chip row + agent
 *      sections in the order the prototype validated.
 *   3. Render a friendly empty state when the operator has zero agents, and
 *      a different empty state when a filter is active and matches nothing.
 */
import { onMounted, computed } from 'vue'
import { useDashboardData } from '@/composables/useDashboardData'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import DashboardHeader from '@/components/dashboard/DashboardHeader.vue'
import DashboardKpiStrip from '@/components/dashboard/DashboardKpiStrip.vue'
import DashboardToolbar from '@/components/dashboard/DashboardToolbar.vue'
import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'
import DashboardSections from '@/components/dashboard/DashboardSections.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const {
  agents,
  filteredAgents,
  ensureLoaded,
  isLoading,
  setChip,
  setQuery,
} = useDashboardData()

const hasAgents = computed(() => agents.value.length > 0)
const isFilteringToEmpty = computed(
  () => hasAgents.value && filteredAgents.value.length === 0,
)

function resetFilters(): void {
  setChip('all')
  setQuery('')
}

onMounted(() => {
  // Fire-and-forget: the stores update reactively as data lands; the page
  // does not need to wait on this promise to start rendering.
  void ensureLoaded()
})
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />

    <main class="flex-1 flex flex-col">
      <DashboardHeader />

      <DashboardKpiStrip />

      <DashboardToolbar />

      <DashboardFilterChips />

      <!-- No agents exist yet: emphasize the create CTA. -->
      <EmptyState
        v-if="!hasAgents && !isLoading"
        title="No agents yet"
        description="Create your first agent to start chatting. Pick from scratch, a template, or upload an existing config."
      />

      <!-- Agents exist but the active filter matches none. -->
      <EmptyState
        v-else-if="isFilteringToEmpty && !isLoading"
        title="No agents match this filter"
        description="Try clearing the filter chip or adjusting the search."
        action-label="Reset filters"
        @action="resetFilters"
      />

      <DashboardSections v-else-if="!isLoading || hasAgents" />
    </main>
  </div>
</template>
