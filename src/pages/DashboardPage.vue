<script setup lang="ts">
/**
 * DashboardPage — the redesigned operator landing.
 *
 * Composes the dashboard subcomponents from Phase 2 and the dashboard state
 * composable (`useDashboardData`) that owns the boot fetch, refresh, KPI
 * derivations, and chip / query / sort filter state. The page also owns the
 * side-effect handlers for kebab-driven actions (`runNewTask`, `settings`,
 * `duplicate`, `archive`, `delete`) — these forward to the create-agent
 * dialog store, the agent route, or surface a toast while we wait for the
 * backend to land the missing endpoints.
 */
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardData } from '@/composables/useDashboardData'
import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
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
const dialogStore = useCreateAgentDialogStore()
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

/**
 * Kebab `Run new task` — opens the create-agent dialog in `blank` mode so
 * the operator can compose a fresh task for the agent. The dialog store
 * doesn't accept an `agentId` yet; once it does, surface the agent id
 * here and skip the manual mode selection.
 */
function onRunNewTask(): void {
  // TODO: pass the agent id to the dialog store once it supports pre-filtering.
  dialogStore.open('blank')
}

/**
 * Kebab `Settings` — routes to the agent's settings page.
 */
function onSettings(agentId: number): void {
  void router.push({ name: 'agent-settings', params: { id: String(agentId) } })
}

/**
 * Kebab `Duplicate` — falls back to opening the create-agent dialog in
 * 'choice' mode. The agent store has no clone API yet, so we surface a
 * toast and let the operator pick "From scratch" or a template.
 */
function onDuplicate(): void {
  // TODO: wire to a real clone flow when the backend lands.
  dialogStore.open('choice')
  toast.info('Use the create dialog to clone this agent\'s config manually.')
}

/**
 * Kebab `Archive` — no agent-store API exists yet, so surface a toast and
 * document the gap here.
 */
function onArchive(): void {
  // TODO: wire to a real archive flow when the backend lands.
  toast.info('Archive is not yet wired')
}

/**
 * Kebab `Delete` — confirms via the global ConfirmDialog. The agent
 * mutation lives in `useAgentStore().deleteAgent` (used by the agent
 * detail page); the dashboard does not own agent mutations directly, so
 * this currently surfaces a toast. Once the dashboard owns the delete
 * flow the dialog handler should call the store with the agent id.
 */
async function onDelete(agentId: number): Promise<void> {
  const ok = await confirm(
    'Delete this agent? This permanently removes the agent and all its tasks.',
    'Delete agent',
    'Delete',
  )
  if (!ok) return
  // TODO: route through the agent store once the dashboard owns agent
  // mutations directly — pass `agentId` to `useAgentStore().deleteAgent`.
  void agentId
  toast.info('Delete is not yet wired from the dashboard.')
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
        @duplicate="onDuplicate"
        @archive="onArchive"
        @delete="onDelete"
      />
    </main>
  </div>
</template>
