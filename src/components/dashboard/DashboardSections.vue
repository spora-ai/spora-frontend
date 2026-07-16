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

const { filteredAgents, state, pinnedVisible, archivedVisible } = useDashboardData()
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
 * Resolve a timestamp string to a recency bucket. Returns `null` for
 * missing / unparseable timestamps so callers can fall through to the
 * next anchor (used by `groupByRecency` to prefer task `updated_at`,
 * then agent `created_at`).
 */
function recencyBucketFromIso(iso: string | undefined, todayStart: number): 'Today' | 'This Week' | 'Older' | null {
  if (iso === undefined) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  if (t >= todayStart) return 'Today'
  const ageDays = (todayStart - t) / MS_PER_DAY
  if (ageDays <= 7) return 'This Week'
  return 'Older'
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
    // Prefer last task updated_at; fall back to agent.created_at; failing
    // both, route to Older.
    const taskBucket = recencyBucketFromIso(lastTaskByAgent.get(agent.id)?.updated_at, todayStart)
    const createdBucket = taskBucket !== null ? null : recencyBucketFromIso(agent.created_at, todayStart)
    const bucket = taskBucket ?? createdBucket ?? 'Older'
    buckets[bucket].push(agent)
  }
  return buckets
}

const grouped: ComputedRef<SectionBuckets> = computed(() => {
  return groupByRecency(filteredAgents.value, taskStore.lastTaskByAgent)
})

/**
 * The set of sections to render, narrowed by the current bucket counts.
 * The chip filter has already been applied upstream via `filteredAgents`,
 * so this just walks SECTION_KEYS in display order and skips empty /
 * flag-gated buckets. "This Week — 0 agents" headings never render.
 *
 * `pinnedVisible` / `archivedVisible` come from `useDashboardData()` so the
 * section grid and the chip row share a single source of truth for whether
 * any loaded agent carries the pin / archive flag.
 */
const visibleSections: ComputedRef<ReadonlyArray<SectionKey>> = computed(() => {
  const counts = grouped.value
  return SECTION_KEYS.filter((key) => {
    if (key === 'Pinned') return pinnedVisible.value && counts.Pinned.length > 0
    if (key === 'Archived') return archivedVisible.value && counts.Archived.length > 0
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
    created: 'Recently created',
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
