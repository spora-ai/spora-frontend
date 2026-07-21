<script setup lang="ts">
/**
 * DashboardPage — the redesigned operator landing.
 *
 * Composes dashboard state and presentation, and owns the navigation and
 * agent mutations triggered by card actions.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardData } from '@/composables/useDashboardData'
import { useAgentStore } from '@/stores/agent'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { globalConnected } from '@/composables/useRealtime'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import DashboardHeader from '@/components/dashboard/DashboardHeader.vue'
import DashboardKpiStrip from '@/components/dashboard/DashboardKpiStrip.vue'
import DashboardToolbar from '@/components/dashboard/DashboardToolbar.vue'
import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'
import DashboardSections from '@/components/dashboard/DashboardSections.vue'

const {
  agents,
  booted,
  filteredAgents,
  lastUpdatedAt,
  setChip,
  setQuery,
  ensureLoaded,
  refresh,
  warmScheduledRuns,
} = useDashboardData()

const router = useRouter()
const agentStore = useAgentStore()
const toast = useToast()
const { confirm } = useConfirmDialog()

function resetFilters(): void {
  setChip('all')
  setQuery('')
}

function onRunNewTask(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent', params: { id: String(agentId) } })
}

function onSettings(agentId: number): Promise<unknown> {
  return router.push({ name: 'agent-settings', params: { id: String(agentId) } })
}

/**
 * Run the kebab mutation with toast feedback on success + failure.
 * Looking up the agent by id first means we tolerate the store being
 * mid-update (e.g. after a refresh that excluded this agent) without
 * throwing — the missing-agent branch is silent on purpose.
 */
/**
 * Toggle a single boolean column on the agent and surface a success /
 * failure toast. Tolerates a missing-agent in the store (silent return)
 * so callers don't need to pre-check.
 */
async function toggleAgentFlag(
  agentId: number,
  column: 'is_archived' | 'is_favorite',
  messages: { flippedOn: string; flippedOff: string; failure: string },
): Promise<void> {
  const agent = agentStore.agents.find(a => a.id === agentId)
  if (!agent) return
  const nextValue = !agent[column]
  try {
    const updated = await agentStore.updateAgent(agentId, { [column]: nextValue })
    toast.success(updated[column] ? messages.flippedOn : messages.flippedOff)
  } catch {
    toast.error(messages.failure)
  }
}

function onArchive(agentId: number): Promise<void> {
  return toggleAgentFlag(agentId, 'is_archived', {
    flippedOn: 'Archived',
    flippedOff: 'Restored',
    failure: 'Failed to update archive state — try again',
  })
}

async function onDelete(agentId: number): Promise<void> {
  const ok = await confirm(
    'Delete this agent? This permanently removes the agent and all its tasks.',
    'Delete agent',
    'Delete',
  )
  if (!ok) return
  try {
    await agentStore.deleteAgent(agentId)
    toast.success('Agent deleted')
  } catch {
    toast.error('Failed to delete agent — try again')
  }
}

function onFavorite(agentId: number): Promise<void> {
  return toggleAgentFlag(agentId, 'is_favorite', {
    flippedOn: 'Added to favorites',
    flippedOff: 'Removed from favorites',
    failure: 'Failed to update favorite state — try again',
  })
}

onMounted(() => {
  // Fire-and-forget. Without Mercure, re-fetch on re-mount so a
  // navigation back to the Dashboard shows fresh state — `booted`
  // short-circuits `ensureLoaded`, and the polling fallback is
  // deliberately skipped on the dashboard route.
  if (booted.value && !globalConnected.value) {
    void refresh()
  }
  void ensureLoaded()
  void warmScheduledRuns()
})
</script>

<template>
  <div>
    <GlobalNavbar :last-updated-at="lastUpdatedAt" />
    <main class="dashboard-main">
      <DashboardHeader />
      <DashboardKpiStrip />
      <DashboardToolbar @reset-filters="resetFilters" />
      <DashboardFilterChips />
      <div class="dashboard-grid-container">
        <p v-if="agents.length === 0" class="empty">
          No agents yet. Create one from the Agents menu.
        </p>
        <p v-else-if="filteredAgents.length === 0" class="empty">
          No agents match the current filters.
          <button type="button" class="reset-link" @click="resetFilters">Reset filters</button>
        </p>
        <DashboardSections
          v-else
          @run-new-task="onRunNewTask"
          @settings="onSettings"
          @favorite="onFavorite"
          @archive="onArchive"
          @delete="onDelete"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.dashboard-main {
  /* Stand-in for the future design tokens — keeps the page from bleeding
   * into the AgentSidebar's flex item without re-introducing a global
   * container style. */
  width: 100%;
  margin: 0 auto;
  padding: 0 1.5rem 2rem 1.5rem;
  max-width: 80rem;
}

.empty-state {
  text-align: center;
  color: hsl(var(--muted-foreground));
  margin: 2rem 0;
  font-size: 0.875rem;
}

.reset-link {
  background: transparent;
  border: 0;
  color: hsl(var(--primary));
  cursor: pointer;
  text-decoration: underline;
  font: inherit;
  margin-left: 0.25rem;
}

.dashboard-grid-container {
  /* Visual breathing room between the toolbar and the bucketed grid. The
   * actual section grid is owned by DashboardSections. */
  margin-top: 1.5rem;
}
</style>
