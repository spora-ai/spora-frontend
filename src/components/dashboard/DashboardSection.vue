<script setup lang="ts">
/**
 * DashboardSection — collapsible group with a header + grid of agent cards.
 *
 * One section = one recency bucket (Pinned / Today / This Week / Older /
 * Archived), rendered by the aggregator `DashboardSections`. The chevron +
 * title + agent-count header acts as the toggle; clicking anywhere on the
 * header collapses the grid via a `data-collapsed` attribute that the
 * scoped CSS uses to animate `max-height` and `opacity`.
 *
 * Card selection routes via `router.push({ name: 'agent', params: { id } })`
 * locally. Kebab-driven actions (`runNewTask`, `settings`, `duplicate`,
 * `archive`, `delete`) are forwarded up to the page-level handler so the
 * Create-Agent dialog, settings route, archive/delete flows live in one
 * place.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import type { Agent } from '@/types/agent'
import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

interface Props {
  /** Section heading — e.g. "Pinned", "Today", "This Week", "Older", "Archived". */
  title: string
  /** Agents rendered in this section's grid. Empty triggers the empty state. */
  agents: Agent[]
}

defineProps<Props>()

/**
 * Emits forwarded from `DashboardAgentCard`. The page-level handler owns
 * the side effects (dialog open, route push, archive/delete confirmation)
 * so this component stays presentational.
 */
const emit = defineEmits<{
  select: [agentId: number]
  runNewTask: [agentId: number]
  settings: [agentId: number]
  duplicate: [agentId: number]
  archive: [agentId: number]
  delete: [agentId: number]
}>()

const router = useRouter()

const collapsed = ref<boolean>(false)

function toggle(): void {
  collapsed.value = !collapsed.value
}

function openAgent(agentId: number): void {
  // The promise from vue-router is allowed to resolve silently; the
  // router's own guards surface any failure to the operator.
  router.push({ name: 'agent', params: { id: String(agentId) } })
}
</script>

<template>
  <section class="dashboard-section" :data-collapsed="collapsed ? 'true' : 'false'">
    <button
      type="button"
      class="section-header"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <svg
        class="chev"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      <h2 class="section-title">{{ title }}</h2>
      <span class="section-count">&middot; {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}</span>
    </button>

    <div v-if="agents.length === 0" class="section-body section-body--empty">
      <EmptyState title="No agents in this section" description="Try another filter." />
    </div>
    <div v-else class="section-body section-grid">
      <DashboardAgentCard
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
        @select="(id) => { openAgent(id); emit('select', id) }"
        @run-new-task="(id) => emit('runNewTask', id)"
        @settings="(id) => emit('settings', id)"
        @duplicate="(id) => emit('duplicate', id)"
        @archive="(id) => emit('archive', id)"
        @delete="(id) => emit('delete', id)"
      />
    </div>
  </section>
</template>

<style scoped>
.dashboard-section {
  display: block;
}

.section-header {
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.25rem;
  cursor: pointer;
  user-select: none;
  outline: none;
}

.section-header:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.chev {
  width: 1rem;
  height: 1rem;
  color: hsl(var(--muted-foreground));
  transition: transform 150ms ease;
}

.dashboard-section[data-collapsed='true'] .chev {
  transform: rotate(-90deg);
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: hsl(var(--foreground));
  margin: 0;
}

.section-count {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.section-body {
  overflow: hidden;
  max-height: 5000px;
  transition: max-height 300ms ease, opacity 200ms ease;
  opacity: 1;
}

.dashboard-section[data-collapsed='true'] .section-body {
  max-height: 0;
  opacity: 0;
}

.section-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 640px) {
  .section-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .section-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.section-body--empty {
  padding: 1rem 0;
}
</style>
