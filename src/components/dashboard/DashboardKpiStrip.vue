<script setup lang="ts">
/**
 * DashboardKpiStrip — the 4-card KPI row that drives the dashboard's state filter.
 *
 * Reads `kpiCounts`, `state.chip`, and `setChip` from `useDashboardData()`.
 * Selecting a card calls `setChip(kpiKey)`; selecting the active card a
 * second time resets the filter to `'all'` so the user can deselect. The
 * manual `refresh()` action is intentionally NOT exposed here — that's the
 * page header's job — so the strip can never trigger a refetch on its own.
 *
 * KPI counts are read inside a `computed`, not snapshotted into a module-
 * level const: when SSE pushes new task events the per-card number must
 * update without waiting for the next manual refresh.
 */
import { computed } from 'vue'
import { useDashboardData, type DashboardChip } from '@/composables/useDashboardData'
import DashboardKpiCard from '@/components/dashboard/DashboardKpiCard.vue'

const { kpiCounts, state, setChip } = useDashboardData()

type KpiKey = 'all' | 'RUNNING' | 'AWAITING' | 'SCHEDULED'

interface KpiDescriptor {
  /** Chip filter value to apply when this KPI is clicked. */
  kpiKey: KpiKey
  /** Label shown in the top row of the card. */
  label: string
  /** Visual accent — recolors the top edge and the count. */
  accent: 'all' | 'running' | 'awaiting' | 'scheduled'
  /**
   * Pulse-light tag rendered next to the label. The strip derives this
   * from `count` so an empty bucket (runningTasks=0 / awaitingTasks=0 /
   * scheduledToday=0) doesn't show a "LIVE" / "YOU" / "SOON" badge
   * that promises activity that's not actually there.
   */
  pulse: 'live' | 'you' | 'soon' | null
  /** Numeric value shown in big type. Resolved from kpiCounts via the descriptor getter. */
  count: number
  /** Helper text under the count. */
  description: string
}

/**
 * Map a numeric count to either the canonical pulse tag (when count > 0)
 * or null (when the bucket is empty). Centralised so the rule is
 * "no pulse indicator on a zero-state card" — applies uniformly to
 * live, you, and soon.
 */
function pulseFor(tag: 'live' | 'you' | 'soon', count: number): 'live' | 'you' | 'soon' | null {
  return count > 0 ? tag : null
}

const kpis = computed<ReadonlyArray<KpiDescriptor>>(() => [
  {
    kpiKey: 'all',
    label: 'Agents',
    accent: 'all',
    pulse: null,
    count: kpiCounts.value.agents,
    description: 'total configured',
  },
  {
    kpiKey: 'RUNNING',
    label: 'Running',
    accent: 'running',
    pulse: pulseFor('live', kpiCounts.value.runningTasks),
    count: kpiCounts.value.runningTasks,
    description: 'tasks in flight',
  },
  {
    kpiKey: 'AWAITING',
    label: 'Awaiting input',
    accent: 'awaiting',
    pulse: pulseFor('you', kpiCounts.value.awaitingTasks),
    count: kpiCounts.value.awaitingTasks,
    description: 'need your approval',
  },
  {
    kpiKey: 'SCHEDULED',
    label: 'Scheduled today',
    accent: 'scheduled',
    pulse: pulseFor('soon', kpiCounts.value.scheduledToday),
    count: kpiCounts.value.scheduledToday,
    description: 'agents firing today',
  },
])

function onSelect(key: KpiKey): void {
  if (state.chip.value === key) {
    setChip('all' as DashboardChip)
  } else {
    setChip(key as DashboardChip)
  }
}
</script>

<template>
  <section class="kpi-strip">
    <DashboardKpiCard
      v-for="kpi in kpis"
      :key="kpi.kpiKey"
      :label="kpi.label"
      :count="kpi.count"
      :accent="kpi.accent"
      :pulse-class="kpi.pulse"
      :active="state.chip.value === kpi.kpiKey"
      :kpi-key="kpi.kpiKey"
      :description="kpi.description"
      @select="onSelect"
    />
  </section>
</template>

<style scoped>
.kpi-strip {
  margin-top: 1.5rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (min-width: 1024px) {
  .kpi-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
