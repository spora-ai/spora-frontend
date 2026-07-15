<script setup lang="ts">
/**
 * DashboardFilterChips — slim chip row beneath the KPI strip / toolbar.
 *
 * Mirrors the prototype's `syncChipButtons` visual: the active chip flips
 * to a foreground-on-background fill so it pops against its neighbors.
 * Selecting a chip routes through `useDashboardData().setChip(...)` —
 * selecting the active chip again resets the filter to `'all'` so the
 * user can dismiss the filter in one click.
 *
 * The KPI-driven chips (RUNNING / AWAITING / SCHEDULED) are intentionally
 * omitted here because the KPI strip owns them — the chip row only
 * carries the lifecycle axes (all / pinned / archived) that do not have a
 * KPI shortcut. The Pinned and Archived chips themselves also disappear
 * while no loaded agent carries the corresponding flag — until the
 * backend exposes `is_pinned`/`is_archived`, showing the chip would just
 * route to an empty bucket.
 */
import { computed } from 'vue'
import { useDashboardData, type DashboardChip } from '@/composables/useDashboardData'
import type { Agent } from '@/types/agent'

type ChipKey = 'all' | 'pinned' | 'archived'

interface ChipDescriptor {
  /** Value passed to `setChip`. */
  key: ChipKey
  /** User-visible label. */
  label: string
}

const { state, setChip, agents } = useDashboardData()

/** Any loaded agent carries the pin flag (tolerates `undefined`). */
function hasPinned(list: Agent[]): boolean {
  return list.some((a) => (a as { is_pinned?: boolean }).is_pinned === true)
}

/** Any loaded agent carries the archive flag (tolerates `undefined`). */
function hasArchived(list: Agent[]): boolean {
  return list.some((a) => (a as { is_archived?: boolean }).is_archived === true)
}

const CHIPS: ReadonlyArray<ChipDescriptor> = [
  { key: 'all', label: 'All' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'archived', label: 'Archived' },
]

const visibleChips = computed<ReadonlyArray<ChipDescriptor>>(() => {
  const list = agents.value
  const result: ChipDescriptor[] = []
  for (const chip of CHIPS) {
    if (chip.key === 'pinned' && !hasPinned(list)) continue
    if (chip.key === 'archived' && !hasArchived(list)) continue
    result.push(chip)
  }
  return result
})

function onSelect(key: ChipKey): void {
  if (state.chip.value === key) {
    setChip('all' as DashboardChip)
    return
  }
  setChip(key as DashboardChip)
}
</script>

<template>
  <div class="filter-chips">
    <button
      v-for="chip in visibleChips"
      :key="chip.key"
      type="button"
      :class="['chip', state.chip.value === chip.key ? 'chip-active' : 'chip-inactive']"
      :data-chip="chip.key"
      :aria-pressed="state.chip.value === chip.key"
      @click="onSelect(chip.key)"
    >
      {{ chip.label }}
    </button>
    <span class="filter-hint">
      Filters split between KPI cards (top) and chips (here).
    </span>
  </div>
</template>

<style scoped>
.filter-chips {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.chip {
  border-radius: 9999px;
  border: 1px solid hsl(var(--border));
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  transition: background-color 150ms ease, color 150ms ease;
}

.chip-active {
  background: hsl(var(--foreground));
  color: hsl(var(--background));
}

.chip-inactive {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.chip-inactive:hover {
  background: hsl(var(--muted));
}

.filter-hint {
  margin-left: auto;
  font-size: 0.6875rem;
  color: hsl(var(--muted-foreground));
}

@media (max-width: 640px) {
  .filter-hint {
    margin-left: 0;
  }
}
</style>
