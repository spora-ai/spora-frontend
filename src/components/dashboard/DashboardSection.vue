<script setup lang="ts">
/**
 * DashboardSection — section header + grid of agent cards.
 *
 * One section = one bucket (Pinned / Favorites / Today / This Week / Older /
 * Archived) rendered by `DashboardSections`, OR the collapsed
 * "All agents — sorted by …" grid for non-activity sorts.
 *
 * The header is purely a heading — collapsing was prototyped but
 * removed: pinning's value is "always visible," and the non-pinned
 * buckets only contain the small handful of fresh / recent / archived
 * agents an operator cares about right now. A collapse affordance added
 * noise without semantic value.
 *
 * Card selection routes via `router.push({ name: 'agent', params: { id } })`
 * locally. Card actions are forwarded up to the page-level handler so
 * navigation and agent mutations live in one place.
 */
import { useRouter } from 'vue-router'

import type { Agent } from '@/types/agent'
import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

interface Props {
  /** Section heading — e.g. "Pinned", "Favorites", "Today", or "Archived". */
  title: string
  /** Agents rendered in this section's grid. Empty triggers the empty state. */
  agents: Agent[]
}

defineProps<Props>()

/**
 * Emits forwarded from `DashboardAgentCard`. The page-level handler owns
 * the side effects (dialog open, route push, archive/delete confirmation)
 * so this component stays presentational.
 *
 * Recent-task row navigation is handled inside `DashboardAgentCard` via
 * a `<router-link>` on the row itself — no `taskOpen` emit needed here.
 */
const emit = defineEmits<{
  select: [agentId: number]
  runNewTask: [agentId: number]
  settings: [agentId: number]
  favorite: [agentId: number]
  archive: [agentId: number]
  delete: [agentId: number]
}>()

const router = useRouter()

function openAgent(agentId: number): void {
  // The promise from vue-router is allowed to resolve silently; the
  // router's own guards surface any failure to the operator.
  router.push({ name: 'agent', params: { id: String(agentId) } })
}
</script>

<template>
  <section>
    <header class="mb-3 flex items-center gap-2 px-1">
      <h2 class="section-title m-0 text-sm font-semibold tracking-tight text-foreground">
        {{ title }}
      </h2>
      <span class="section-count text-xs text-muted-foreground">&middot; {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}</span>
    </header>

    <div
      v-if="agents.length === 0"
      class="py-4"
    >
      <EmptyState
        title="No agents in this section"
        description="Try another filter."
      />
    </div>
    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      <DashboardAgentCard
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
        @select="(id) => { openAgent(id); emit('select', id) }"
        @run-new-task="(id) => emit('runNewTask', id)"
        @settings="(id) => emit('settings', id)"
        @favorite="(id) => emit('favorite', id)"
        @archive="(id) => emit('archive', id)"
        @delete="(id) => emit('delete', id)"
      />
    </div>
  </section>
</template>
