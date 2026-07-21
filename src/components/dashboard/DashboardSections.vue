<script setup lang="ts">
/**
 * DashboardSections — renders the agent grid for the dashboard.
 *
 * Two render modes, switched by `useBucketedGrid`:
 *
 * - **Bucketed** (`sort === 'activity'` and chip is 'all' / a lifecycle
 *   chip): groups the filtered agents by recency against
 *   `taskStore.lastTaskByAgent.updated_at` (with `agent.created_at`
 *   fallback when the agent has no task yet) into six buckets: Pinned /
 *   Favorites / Today / This Week / Older / Archived. Each non-empty
 *   bucket renders a `DashboardSection`.
 *
 * - **Collapsed** (sort ≠ 'activity'): skips the recency bucketing and
 *   renders a single "All agents" grid so the operator sees one sorted
 *   list instead of the same agents split across sections. Pinned, Favorites,
 *   and Archived chips force bucketed mode under every sort.
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

const { filteredAgents, state, pinnedVisible, favoritesVisible, archivedVisible } = useDashboardData()
const taskStore = useTaskStore()

const emit = defineEmits<{
  runNewTask: [agentId: number]
  settings: [agentId: number]
  favorite: [agentId: number]
  archive: [agentId: number]
  delete: [agentId: number]
  taskOpen: [taskId: number]
}>()

type SectionKey = 'Pinned' | 'Favorites' | 'Today' | 'This Week' | 'Older' | 'Archived'

interface SectionBuckets {
  Pinned: Agent[]
  Favorites: Agent[]
  Today: Agent[]
  'This Week': Agent[]
  Older: Agent[]
  Archived: Agent[]
}

const SECTION_KEYS: ReadonlyArray<SectionKey> = ['Pinned', 'Favorites', 'Today', 'This Week', 'Older', 'Archived']

interface PinnedAgent extends Agent {
  is_pinned?: boolean
}

interface FavoriteAgent extends Agent {
  is_favorite?: boolean
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
 * Bucket the (already chip/query/sort filtered) `agents` by recency and
 * favorite/pin/archive flags. Recency prefers the agent's last task
 * `updated_at`; when no task exists it falls back to `agent.created_at`.
 * Favorite, pinned, and archived agents override recency in that precedence
 * order, while agents without a usable timestamp fall back to `Older`.
 */
function groupByRecency(agentList: Agent[], lastTaskByAgent: ReadonlyMap<number, Task>): SectionBuckets {
  const buckets: SectionBuckets = {
    Pinned: [],
    Favorites: [],
    Today: [],
    'This Week': [],
    Older: [],
    Archived: [],
  }
  const todayStart = startOfToday()
  for (const agent of agentList) {
    if ((agent as FavoriteAgent).is_favorite === true) {
      buckets.Favorites.push(agent)
      continue
    }
    if ((agent as PinnedAgent).is_pinned === true) {
      buckets.Pinned.push(agent)
      continue
    }
    if ((agent as ArchivedAgent).is_archived === true) {
      buckets.Archived.push(agent)
      continue
    }
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
 * The visibility computeds come from `useDashboardData()` so the section
 * grid and chip row share one source of truth for all three flags.
 */
const visibleSections: ComputedRef<ReadonlyArray<SectionKey>> = computed(() => {
  const counts = grouped.value
  return SECTION_KEYS.filter((key) => {
    if (key === 'Pinned') return pinnedVisible.value && counts.Pinned.length > 0
    if (key === 'Favorites') return favoritesVisible.value && counts.Favorites.length > 0
    if (key === 'Archived') return archivedVisible.value && counts.Archived.length > 0
    return counts[key].length > 0
  })
})

/** Helper for the template — given a key, return the agents in that bucket. */
function agentsFor(key: SectionKey): Agent[] {
  return grouped.value[key]
}

/**
 * Whether to render the bucketed grid or collapse to a single sorted grid.
 * Activity sort keeps recency buckets visible; Pinned, Favorites, and
 * Archived chips force bucketed mode under every sort.
 */
const useBucketedGrid = computed<boolean>(() => {
  if (state.chip.value === 'pinned' || state.chip.value === 'favorites' || state.chip.value === 'archived') return true
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
          @run-new-task="(id) => emit('runNewTask', id)"
          @settings="(id) => emit('settings', id)"
          @favorite="(id) => emit('favorite', id)"
          @archive="(id) => emit('archive', id)"
          @delete="(id) => emit('delete', id)"
          @task-open="(id) => emit('taskOpen', id)"
        />
      </template>
    </template>
    <DashboardSection
      v-else
      :title="collapsedTitle"
      :agents="filteredAgents"
      @run-new-task="(id) => emit('runNewTask', id)"
      @settings="(id) => emit('settings', id)"
      @favorite="(id) => emit('favorite', id)"
      @archive="(id) => emit('archive', id)"
      @delete="(id) => emit('delete', id)"
      @task-open="(id) => emit('taskOpen', id)"
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
