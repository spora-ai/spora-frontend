<script setup lang="ts">
/**
 * DashboardSections — renders the agent grid for the dashboard.
 *
 * Two render modes, switched by `useBucketedGrid`:
 *
 * - **Bucketed** (`sort === 'activity'` and chip is 'all' / a lifecycle
 *   chip): groups the filtered agents by recency against
 *   `taskStore.lastTaskByAgent.updated_at` (with `agent.created_at`
 *   fallback when the agent has no task yet) into the prototype's
 *   five buckets: Pinned / Today / This Week / Older / Archived.
 *   Each non-empty bucket renders a `DashboardSection`.
 *
 * - **Collapsed** (sort ≠ 'activity'): skips the recency bucketing and
 *   renders a single "All agents" grid so the operator sees one sorted
 *   list instead of the same agents split across sections. Pin / Archive
 *   chips force the bucketed mode on even under sort, because pinning
 *   to the top of a single alphabetical grid loses the affordance the
 *   Pinned section provides.
 *
 * The chip-filter is consumed upstream via `filteredAgents`, so this
 * component does NOT also narrow by chip — that would double-filter.
 *
 * The grouping helper lives inline (rather than as a module export) so
 * the component has no transitive coupling to other dashboard modules;
 * this keeps the spec focused on the renderer's behavior.
 */
import { computed, type ComputedRef } from 'vue'

import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'
import { useDashboardData, type DashboardSort } from '@/composables/useDashboardData'
import { useTaskStore } from '@/stores/tasks'
import DashboardSection from '@/components/dashboard/DashboardSection.vue'

const { filteredAgents, agents, state } = useDashboardData()
const taskStore = useTaskStore()

type SectionKey = 'Pinned' | 'Today' | 'This Week' | 'Older' | 'Archived'

interface SectionBuckets {
  Pinned: Agent[]
  Today: Agent[]
  'This Week': Agent[]
  Older: Agent[]
  Archived: Agent[]
}

const SECTION_KEYS: ReadonlyArray<SectionKey> = ['Pinned', 'Today', 'This Week', 'Older', 'Archived']

interface PinnedAgent extends Agent {
  is_pinned?: boolean
}

interface ArchivedAgent extends Agent {
  is_archived?: boolean
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Bucket the (already chip/query/sort filtered) `agents` by recency +
 * pin/archive flags. Recency prefers the agent's last task `updated_at`;
 * when no task exists it falls back to `agent.created_at` so a
 * freshly-created agent lands in the bucket its creation date belongs
 * to (not always `Today`). Agents for which neither field is known land
 * in `Older` as a last resort — future backend support will populate
 * `created_at`. Pinned and Archived override the recency bucket so the
 * user sees them at fixed positions.
 */
function groupByRecency(agentList: Agent[], lastTaskByAgent: ReadonlyMap<number, Task>): SectionBuckets {
  const buckets: SectionBuckets = {
    Pinned: [],
    Today: [],
    'This Week': [],
    Older: [],
    Archived: [],
  }
  const todayStart = startOfToday()
  for (const agent of agentList) {
    // Pinned takes precedence over Archived so a pinned agent that's later
    // archived still surfaces in the Pinned section above all others.
    if ((agent as PinnedAgent).is_pinned === true) {
      buckets.Pinned.push(agent)
      continue
    }
    if ((agent as ArchivedAgent).is_archived === true) {
      buckets.Archived.push(agent)
      continue
    }
    const last = lastTaskByAgent.get(agent.id)
    if (last) {
      const updated = new Date(last.updated_at).getTime()
      if (!Number.isNaN(updated)) {
        if (updated >= todayStart) { buckets.Today.push(agent); continue }
        const ageDays = (todayStart - updated) / MS_PER_DAY
        if (ageDays <= 7) { buckets['This Week'].push(agent); continue }
        buckets.Older.push(agent)
        continue
      }
    }
    // No task yet (or the task timestamp didn't parse). Fall back to the
    // agent's creation date so an operator can find a freshly-created
    // agent in the bucket its age belongs to. An agent with no
    // `created_at` (backend pre-feature) lands in `Older`.
    if (agent.created_at !== undefined) {
      const created = new Date(agent.created_at).getTime()
      if (!Number.isNaN(created)) {
        if (created >= todayStart) { buckets.Today.push(agent); continue }
        const ageDays = (todayStart - created) / MS_PER_DAY
        if (ageDays <= 7) { buckets['This Week'].push(agent); continue }
        buckets.Older.push(agent)
        continue
      }
    }
    buckets.Older.push(agent)
  }
  return buckets
}

const grouped: ComputedRef<SectionBuckets> = computed(() => {
  return groupByRecency(filteredAgents.value, taskStore.lastTaskByAgent)
})

/** True if any *unfiltered* loaded agent has `is_pinned` set — gates the
 * Pinned section heading and chip so we don't render an empty bucket
 * before the backend starts emitting the flag. Uses `agents` (the raw
 * store list) so the gate is consistent with `DashboardFilterChips`,
 * which reads the same. The check tolerates `undefined` (`is_pinned` is
 * optional on `Agent` until the backend PR lands). */
const pinningEnabled = computed<boolean>(() =>
  agents.value.some((a) => (a as PinnedAgent).is_pinned === true),
)

/** Same gate for `is_archived`. */
const archivingEnabled = computed<boolean>(() =>
  agents.value.some((a) => (a as ArchivedAgent).is_archived === true),
)

/**
 * The set of sections to render, narrowed by the current bucket counts.
 * The chip filter has already been applied upstream via `filteredAgents`,
 * so this just walks SECTION_KEYS in display order and skips empty /
 * flag-gated buckets. "This Week — 0 agents" headings never render.
 */
const visibleSections: ComputedRef<ReadonlyArray<SectionKey>> = computed(() => {
  const counts = grouped.value
  return SECTION_KEYS.filter((key) => {
    if (key === 'Pinned') return pinningEnabled.value && counts.Pinned.length > 0
    if (key === 'Archived') return archivingEnabled.value && counts.Archived.length > 0
    return counts[key].length > 0
  })
})

/** Helper for the template — given a key, return the agents in that bucket. */
function agentsFor(key: SectionKey): Agent[] {
  return grouped.value[key]
}

/**
 * Whether to render the bucketed grid (Pinned / Today / This Week /
 * Older / Archived) or collapse to a single sorted grid. Default sort
 * (`'activity'`) keeps the buckets so the recency signal is visible.
 * Any other sort collapses the grid so the operator sees one sorted
 * list. Pin / Archive chips force the bucketed view regardless of sort
 * — pinning to the top of a single sorted list loses the affordance
 * the dedicated Pinned section provides.
 */
const useBucketedGrid = computed<boolean>(() => {
  if (state.chip.value === 'pinned' || state.chip.value === 'archived') return true
  return state.sort.value === 'activity'
})

/**
 * Heading for the collapsed grid. Includes the active sort so the
 * operator can see why the buckets disappeared — e.g. "All agents —
 * sorted by name".
 */
const collapsedTitle = computed<string>(() => {
  const sortLabels: Record<DashboardSort, string> = {
    activity: 'Last activity',
    name: 'Name',
    created: 'Recent (Created proxy)',
    tasks: 'Task count',
  }
  return `All agents — sorted by ${sortLabels[state.sort.value]}`
})
</script>

<template>
  <div class="dashboard-sections">
    <template v-if="useBucketedGrid">
      <template v-for="key in visibleSections" :key="key">
        <DashboardSection
          :title="key"
          :agents="agentsFor(key)"
        />
      </template>
    </template>
    <DashboardSection
      v-else
      :title="collapsedTitle"
      :agents="filteredAgents"
    />
  </div>
</template>

<style scoped>
.dashboard-sections {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}
</style>
