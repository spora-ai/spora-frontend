<script setup lang="ts">
/**
 * DashboardScheduledChip — per-card "next run" pill.
 *
 * Reads from the shared `useScheduledRunsCache` so a parent aggregator
 * (or sibling card) can warm the cache and we reuse the entry instead of
 * refetching. The chip only renders when the agent has at least one active
 * scheduled run — no empty "—" placeholder.
 *
 * Lifecycle:
 *   1. On mount we read the cache. If fresh, render immediately.
 *   2. Otherwise we kick off `loadForAgent(agentId)` once and show a tiny
 *      skeleton placeholder while the request is in flight.
 *   3. When multiple active runs exist we surface the soonest one (the cache
 *      payload is reused as-is — no client-side filtering on the chip).
 *
 * Emits: none — the chip is informational. Card-level click interactions
 * belong on `DashboardAgentCard`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useScheduledRunsCache } from '@/stores/scheduledRunsCache'
import type { ScheduledRunResource } from '@/types/scheduledRun'
import Skeleton from '@/components/ui/Skeleton.vue'

interface Props {
  /** ID of the agent whose next scheduled run this chip displays. */
  agentId: number
}

const props = defineProps<Props>()

const cache = useScheduledRunsCache()

/** True while the first fetch triggered by this component is in flight. */
const isLoading = ref(false)
/** Cached runs for this agent, refreshed whenever the cache invalidates. */
const runs = ref<ScheduledRunResource[] | undefined>(cache.getCached(props.agentId))

/**
 * The next active run this chip should display. We pick the soonest by
 * `next_run_at` (falling back to `run_at` for one-shots), so card viewers
 * always see the most imminent schedule regardless of how many runs exist.
 */
const nextRun = computed<ScheduledRunResource | null>(() => {
  const list = runs.value
  if (!list || list.length === 0) return null
  const active = list.filter((r) => r.is_active)
  if (active.length === 0) return null
  return active.slice().sort((a, b) => {
    const aKey = a.next_run_at ?? a.run_at ?? a.updated_at
    const bKey = b.next_run_at ?? b.run_at ?? b.updated_at
    return new Date(aKey).getTime() - new Date(bKey).getTime()
  })[0]
})

/** Friendly label for the chip — falls back to the cron if no `next_run_at`. */
const displayLabel = computed<string | null>(() => {
  const run = nextRun.value
  if (!run) return null
  if (run.next_run_at) {
    try {
      const dt = new Date(run.next_run_at)
      return formatClock(dt)
    } catch {
      return null
    }
  }
  return null
})

const cronLabel = computed<string | null>(() => nextRun.value?.cron_expression ?? null)

function formatClock(dt: Date): string {
  // Relative phrasing the prototype uses: "Tomorrow 09:00".
  // We render the time-of-day HH:mm in 24-hour form so cron expressions
  // stay readable beside the friendly label.
  const now = new Date()
  const sameDay = dt.getFullYear() === now.getFullYear()
    && dt.getMonth() === now.getMonth()
    && dt.getDate() === now.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = dt.getFullYear() === tomorrow.getFullYear()
    && dt.getMonth() === tomorrow.getMonth()
    && dt.getDate() === tomorrow.getDate()

  const hours = dt.getHours().toString().padStart(2, '0')
  const minutes = dt.getMinutes().toString().padStart(2, '0')
  const clock = `${hours}:${minutes}`

  if (sameDay) return `Today ${clock}`
  if (isTomorrow) return `Tomorrow ${clock}`
  // Weekday for anything beyond tomorrow (within the next 6 days).
  const diffDays = Math.round((dt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays > 0 && diffDays < 7) {
    return `${dt.toLocaleDateString(undefined, { weekday: 'long' })} ${clock}`
  }
  // Beyond a week — show a short date + clock.
  return `${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`
}

async function ensureLoaded(): Promise<void> {
  if (runs.value !== undefined) return
  isLoading.value = true
  try {
    runs.value = await cache.loadForAgent(props.agentId)
  } catch {
    // Surface a silent empty state — the agent card simply omits the chip
    // if the network call fails, rather than breaking card layout.
    runs.value = []
  } finally {
    isLoading.value = false
  }
}

// Refresh local copy when the aggregator invalidates and rewrites the entry.
watch(
  () => cache.cache.get(props.agentId),
  (entry) => {
    if (entry) runs.value = entry.runs
  },
  { flush: 'post' },
)

onMounted(() => {
  void ensureLoaded()
})
</script>

<template>
  <span
    v-if="isLoading || nextRun"
    class="dashboard-scheduled-chip"
    :title="cronLabel ? `Cron: ${cronLabel}` : undefined"
  >
    <svg
      class="chip-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
    <template v-if="isLoading">
      <Skeleton width="6rem" height="0.75rem" />
    </template>
    <template v-else-if="nextRun">
      <span>{{ displayLabel }}</span>
      <span v-if="cronLabel" class="chip-cron">{{ cronLabel }}</span>
    </template>
  </span>
</template>

<style scoped>
.dashboard-scheduled-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(139, 92, 246, 0.3);
  background: hsl(var(--muted));
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  line-height: 0.875rem;
  font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

:global(.dark) .dashboard-scheduled-chip {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.chip-icon {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
}

.chip-cron {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: 0.75;
}
</style>
