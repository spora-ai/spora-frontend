<script setup lang="ts">
/**
 * DashboardSections — renders the recency-bucketed grid for the dashboard.
 *
 * Pulls raw `agents` from `useDashboardData()` and groups them by recency
 * (against `taskStore.lastTaskByAgent.updated_at`) into the prototype's
 * five buckets: Pinned / Today / This Week / Older / Archived. Each
 * non-empty bucket renders a `DashboardSection`; chip filters narrow what
 * is shown.
 *
 * Chip filter rules (mirrors the prototype's `render()` branch):
 *   - chip === 'all'              → all five sections
 *   - chip === 'pinned'           → only Pinned section
 *   - chip === 'archived'         → only Archived section
 *   - chip === RUNNING/AWAITING/SCHEDULED → all sections
 *     (the per-card state pill already filters by the active state)
 *
 * The grouping helper lives inline (rather than as a module export) so
 * the component has no transitive coupling to other dashboard modules;
 * this keeps the spec focused on the renderer's behavior.
 */
import { computed, type ComputedRef } from 'vue'

import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'
import { useDashboardData } from '@/composables/useDashboardData'
import { useTaskStore } from '@/stores/tasks'
import DashboardSection from '@/components/dashboard/DashboardSection.vue'

const { agents, state } = useDashboardData()
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
 * Bucket `agents` by recency + pin/archive flags. The recency is measured
 * against each agent's most recent task (`taskStore.lastTaskByAgent`);
 * agents with no recorded task fall into `Older`. Pinned and Archived
 * override the recency bucket so the user sees them at fixed positions.
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
    if (!last) {
      buckets.Older.push(agent)
      continue
    }
    const updated = new Date(last.updated_at).getTime()
    if (Number.isNaN(updated) || updated >= todayStart) {
      buckets.Today.push(agent)
      continue
    }
    const ageDays = (todayStart - updated) / MS_PER_DAY
    if (ageDays <= 7) {
      buckets['This Week'].push(agent)
      continue
    }
    buckets.Older.push(agent)
  }
  return buckets
}

const grouped: ComputedRef<SectionBuckets> = computed(() => {
  return groupByRecency(agents.value, taskStore.lastTaskByAgent)
})

/** True if any loaded agent has `is_pinned` set — gates the Pinned section
 * and chip so we don't render an empty bucket before the backend starts
 * emitting the flag. The check tolerates `undefined` (`is_pinned` is
 * optional on `Agent` until the backend PR lands). */
const pinningEnabled = computed<boolean>(() =>
  agents.value.some((a) => (a as PinnedAgent).is_pinned === true),
)

/** Same gate for `is_archived`. */
const archivingEnabled = computed<boolean>(() =>
  agents.value.some((a) => (a as ArchivedAgent).is_archived === true),
)

/**
 * The set of sections to render, narrowed by the active chip. Returns
 * an empty list when the filter selects a bucket that has no entries.
 * Pinned and Archived also disappear when no agent carries the flag —
 * we don't render empty buckets the user can't act on.
 */
const visibleSections: ComputedRef<ReadonlyArray<SectionKey>> = computed(() => {
  const chip = state.chip.value
  if (chip === 'pinned') {
    return pinningEnabled.value ? ['Pinned' as const] : []
  }
  if (chip === 'archived') {
    return archivingEnabled.value ? ['Archived' as const] : []
  }
  // For 'all' / RUNNING / AWAITING / SCHEDULED: drop Pinned if no agents
  // carry the flag, and drop Archived likewise. The remaining recency
  // buckets always render so the user sees the agent list even when
  // pinning / archiving is not yet wired.
  return SECTION_KEYS.filter((key) => {
    if (key === 'Pinned') return pinningEnabled.value
    if (key === 'Archived') return archivingEnabled.value
    return true
  })
})

/** Helper for the template — given a key, return the agents in that bucket. */
function agentsFor(key: SectionKey): Agent[] {
  return grouped.value[key]
}
</script>

<template>
  <div class="dashboard-sections">
    <template v-for="key in visibleSections" :key="key">
      <DashboardSection
        :title="key"
        :agents="agentsFor(key)"
      />
    </template>
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
