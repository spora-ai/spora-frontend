<script setup lang="ts">
/**
 * DashboardPage — the redesigned operator landing.
 *
 * Composes dashboard state and presentation, and owns the navigation and
 * agent mutations triggered by card actions.
 */
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardData } from '@/composables/useDashboardData'
import { useAgentStore } from '@/stores/agent'
import { useToast } from '@/composables/useToast'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
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
  warmScheduledRuns,
  isLoading,
  setChip,
  setQuery,
} = useDashboardData()

const router = useRouter()
const agentStore = useAgentStore()
const toast = useToast()
const { confirm } = useConfirmDialog()

const hasAgents = computed(() => agents.value.length > 0)
const isFilteringToEmpty = computed(
  () => hasAgents.value && filteredAgents.value.length === 0,
)

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

async function onArchive(agentId: number): Promise<void> {
  const agent = agentStore.agents.find(a => a.id === agentId)
  if (!agent) return
  const updated = await agentStore.updateAgent(agentId, { is_archived: !agent.is_archived })
  toast.success(updated.is_archived ? 'Archived' : 'Restored')
}

async function onDelete(agentId: number): Promise<void> {
  const ok = await confirm(
    'Delete this agent? This permanently removes the agent and all its tasks.',
    'Delete agent',
    'Delete',
  )
  if (!ok) return
  await agentStore.deleteAgent(agentId)
  toast.success('Agent deleted')
}

async function onFavorite(agentId: number): Promise<void> {
  const agent = agentStore.agents.find(a => a.id === agentId)
  if (!agent) return
  const updated = await agentStore.updateAgent(agentId, { is_favorite: !agent.is_favorite })
  toast.success(updated.is_favorite ? 'Added to favorites' : 'Removed from favorites')
}

function onTaskOpen(taskId: number): Promise<unknown> {
  return router.push({ name: 'task', params: { id: String(taskId) } })
}

onMounted(() => {
  // Fire-and-forget: the stores update reactively as data lands; the page
  // does not need to wait on this promise to start rendering.
  void ensureLoaded()
  void warmScheduledRuns()
})
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />

    <main class="flex-1 flex flex-col">
      <div class="mx-auto w-full max-w-7xl px-6 py-8 flex flex-col">
        <DashboardHeader />

        <DashboardKpiStrip />

        <DashboardToolbar />

        <DashboardFilterChips />

        <!-- Cold-boot loading hint so a blank page is never rendered while the
             boot fetch is in flight and agents haven't arrived yet. -->
        <div v-if="isLoading && !hasAgents" class="dashboard-loading" aria-busy="true">
          <span class="dashboard-loading-spinner" />
          <span>Loading agents…</span>
        </div>

        <!-- No agents exist yet: emphasize the create CTA. -->
        <EmptyState
          v-else-if="!hasAgents"
          title="No agents yet"
          description="Create your first agent to start chatting. Pick from scratch, a template, or upload an existing config."
        />

        <!-- Agents exist but the active filter matches none. -->
        <EmptyState
          v-else-if="isFilteringToEmpty"
          title="No agents match this filter"
          description="Try clearing the filter chip or adjusting the search."
          action-label="Reset filters"
          @action="resetFilters"
        />

        <DashboardSections
          v-else
          @run-new-task="onRunNewTask"
          @settings="onSettings"
          @favorite="onFavorite"
          @archive="onArchive"
          @delete="onDelete"
          @task-open="onTaskOpen"
        />
      </div>
    </main>
  </div>
</template>
