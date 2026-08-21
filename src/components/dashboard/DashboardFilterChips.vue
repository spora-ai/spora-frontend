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
 * omitted because the KPI strip owns them. This row carries All, Pinned,
 * Favorites, and Archived; each flag-specific chip disappears when no
 * loaded agent matches it.
 *
 * A multi-select "Groups" dropdown sits to the right of the chip row.
 * Selecting a group narrows the agent grid (and the agent sidebar
 * buckets); clearing the selection resets to "all visible".
 */
import { computed, ref } from 'vue'
import { useDashboardData, type DashboardChip } from '@/composables/useDashboardData'
import Icon from '@/components/ui/Icon.vue'

type ChipKey = 'all' | 'pinned' | 'favorites' | 'archived'

interface ChipDescriptor {
  /** Value passed to `setChip`. */
  key: ChipKey
  /** User-visible label. */
  label: string
}

const {
  state,
  setChip,
  pinnedVisible,
  favoritesVisible,
  archivedVisible,
  selectedPrincipalIds,
  setPrincipalFilter,
} = useDashboardData()

const CHIPS: ReadonlyArray<ChipDescriptor> = [
  { key: 'all', label: 'All' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'archived', label: 'Archived' },
]

/** Drop flag-specific chips that would render an empty section. */
const visibleChips = computed<ReadonlyArray<ChipDescriptor>>(() => {
  const result: ChipDescriptor[] = []
  for (const descriptor of CHIPS) {
    if (descriptor.key === 'pinned' && !pinnedVisible.value) continue
    if (descriptor.key === 'favorites' && !favoritesVisible.value) continue
    if (descriptor.key === 'archived' && !archivedVisible.value) continue
    result.push(descriptor)
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

// Use the agent store + principals store via composable to discover the
// groups that actually own at least one loaded agent. Importing stores
// here keeps the dashboard's group list driven by the data, not a
// hard-coded principal list.
import { useAgentStore } from '@/stores/agent'
import { usePrincipalsStore } from '@/stores/principals'

const agentStore = useAgentStore()
const principalsStore = usePrincipalsStore()

const groupFilterOptions = computed(() => {
  const groupIds = new Set<number>()
  for (const agent of agentStore.agents) {
    if (agent.principal?.type === 'group' && agent.principal.group_id !== undefined) {
      groupIds.add(agent.principal.group_id)
    }
  }
  return Array.from(groupIds)
    .sort((a, b) => a - b)
    .map((id) => {
      const principal = principalsStore.principals.find(
        (p) => p.type === 'group' && p.group_id === id,
      )
      return { id, label: principal?.name ?? `Group #${id}` }
    })
})

const groupsOpen = ref(false)

const isGroupSelected = (id: number): boolean => selectedPrincipalIds.value.includes(id)

function toggleGroup(id: number): void {
  const current = selectedPrincipalIds.value
  const next = isGroupSelected(id)
    ? current.filter((x) => x !== id)
    : [...current, id]
  setPrincipalFilter(next)
}

function clearGroups(): void {
  setPrincipalFilter([])
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

    <div v-if="groupFilterOptions.length > 0" class="groups-control">
      <button
        type="button"
        class="chip chip-inactive groups-trigger"
        :class="selectedPrincipalIds.length > 0 ? 'chip-active' : ''"
        :data-groups-count="selectedPrincipalIds.length"
        :aria-pressed="selectedPrincipalIds.length > 0"
        @click="groupsOpen = !groupsOpen"
      >
        <Icon name="agents" class="h-3.5 w-3.5 mr-1" />
        Groups
        <span v-if="selectedPrincipalIds.length > 0" class="groups-count-pill">
          {{ selectedPrincipalIds.length }}
        </span>
        <Icon
          name="chevron-down"
          class="h-3.5 w-3.5 ml-1 transition-transform"
          :class="groupsOpen ? '-rotate-180' : ''"
        />
      </button>

      <div v-if="groupsOpen" class="groups-menu" role="menu">
        <button
          v-for="opt in groupFilterOptions"
          :key="opt.id"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="isGroupSelected(opt.id)"
          class="groups-item"
          :data-checked="isGroupSelected(opt.id) ? 'true' : 'false'"
          @click="toggleGroup(opt.id)"
        >
          <span class="groups-item-check" :class="isGroupSelected(opt.id) ? 'is-checked' : ''" />
          {{ opt.label }}
        </button>
        <button
          v-if="selectedPrincipalIds.length > 0"
          type="button"
          class="groups-clear"
          @click="clearGroups"
        >
          Clear selection
        </button>
      </div>
    </div>

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
  display: inline-flex;
  align-items: center;
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

.groups-control {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.groups-count-pill {
  margin-left: 0.375rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 0.6875rem;
  padding: 0 0.375rem;
  min-width: 1.25rem;
  line-height: 1.25rem;
}

.groups-trigger {
  gap: 0.25rem;
}

.groups-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  z-index: 20;
  min-width: 14rem;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.08);
  padding: 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.groups-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  background: transparent;
  border: 0;
  text-align: left;
  font-size: 0.8125rem;
  color: hsl(var(--foreground));
  cursor: pointer;
}
.groups-item:hover {
  background: hsl(var(--muted));
}
.groups-item-check {
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 0.25rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  display: inline-block;
  position: relative;
}
.groups-item-check.is-checked {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
}
.groups-item-check.is-checked::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4px;
  width: 4px;
  height: 7px;
  border-right: 2px solid hsl(var(--primary-foreground));
  border-bottom: 2px solid hsl(var(--primary-foreground));
  transform: rotate(45deg);
}

.groups-clear {
  margin-top: 0.25rem;
  border-top: 1px solid hsl(var(--border));
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  background: transparent;
  border: 0;
  text-align: left;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.groups-clear:hover {
  color: hsl(var(--foreground));
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