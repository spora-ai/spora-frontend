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
 * To the right of those flag chips sits the principal-scope row: a flat
 * single-select strip of `ALL` + `My Agents` + one chip per group that
 * owns at least one loaded agent. Clicking a scope chip routes through
 * `useDashboardData().setPrincipalFilter(...)`. Single-select because
 * the chips represent mutually-exclusive scopes — you either look at
 * the user's private agents or a single group's agents, not both.
 */
import { computed } from 'vue'
import { useDashboardData, type PrincipalFilter } from '@/composables/useDashboardData'
import { useAuthStore } from '@/stores/auth'
import { useAgentStore } from '@/stores/agent'

import Icon from '@/components/ui/Icon.vue'

type ChipKey = 'all' | 'pinned' | 'favorites' | 'archived'

interface FlagChip {
  key: Exclude<ChipKey, 'all'>
  label: string
}

interface ScopeChip {
  /** Discriminator for the principal filter type. */
  filter: PrincipalFilter
  /** User-visible label. */
  label: string
}

const {
  state,
  setChip,
  pinnedVisible,
  favoritesVisible,
  archivedVisible,
  selectedPrincipalFilter,
  setPrincipalFilter,
  callerPrincipalId,
} = useDashboardData()

const FLAG_CHIPS: ReadonlyArray<FlagChip> = [
  { key: 'pinned', label: 'Pinned' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'archived', label: 'Archived' },
]

/** Drop flag-specific chips that would render an empty section. */
const visibleFlagChips = computed<ReadonlyArray<FlagChip>>(() => {
  const result: FlagChip[] = []
  for (const descriptor of FLAG_CHIPS) {
    if (descriptor.key === 'pinned' && !pinnedVisible.value) continue
    if (descriptor.key === 'favorites' && !favoritesVisible.value) continue
    if (descriptor.key === 'archived' && !archivedVisible.value) continue
    result.push(descriptor)
  }
  return result
})

function onFlagChipClick(key: ChipKey): void {
  if (state.chip.value === key) {
    setChip('all')
    return
  }
  setChip(key)
}

const authStore = useAuthStore()
const agentStore = useAgentStore()

/**
 * Map of group_id → display name. Reads `agent.principal.name` off
 * the cached agent payload rather than the `usePrincipalsStore` cache
 * so the chip works on first paint — before any page has warmed
 * the principals store.
 */
const groupLabelsByAgent = computed<Map<number, string | undefined>>(() => {
  const labels = new Map<number, string | undefined>()
  for (const agent of agentStore.agents) {
    if (agent.principal?.type === 'group' && agent.principal.group_id !== undefined) {
      // First agent wins; all agents in a group share the same principal.
      if (!labels.has(agent.principal.group_id)) {
        labels.set(agent.principal.group_id, agent.principal.name)
      }
    }
  }
  return labels
})

/** Sorted group ids that have at least one loaded agent. */
const groupIdsWithAgents = computed<number[]>(() => {
  return Array.from(groupLabelsByAgent.value.keys()).sort((a, b) => a - b)
})

/** Label for a group principal id, falling back to `Group #N`. */
function groupLabel(groupId: number): string {
  const name = groupLabelsByAgent.value.get(groupId)
  return name ?? `Group #${groupId}`
}

/**
 * All visible scope chips in order: ALL, My Agents (only when the caller
 * has a user-principal row), then one chip per group that owns agents.
 * The order is stable across renders so chip positions don't shuffle
 * on data refetch.
 */
const scopeChips = computed<ReadonlyArray<ScopeChip>>(() => {
  const out: ScopeChip[] = [{ filter: 'all', label: 'All' }]
  // "My Agents" is only meaningful when the caller actually has a
  // user-principal row — newly-bootstrapped users or SSO-only accounts
  // would see an empty chip.
  if (callerPrincipalId.value !== null) {
    const me = authStore.user
    out.push({ filter: 'mine', label: me?.name ? `My Agents (${me.name})` : 'My Agents' })
  }
  for (const gid of groupIdsWithAgents.value) {
    out.push({ filter: gid, label: groupLabel(gid) })
  }
  return out
})

function isScopeActive(filter: PrincipalFilter): boolean {
  return selectedPrincipalFilter.value === filter
}

function onScopeChipClick(filter: PrincipalFilter): void {
  // Single-select: clicking the active chip resets to 'all' so the
  // user can dismiss the filter in one click (matches the flag-chip
  // toggle behaviour above).
  if (isScopeActive(filter)) {
    setPrincipalFilter('all')
    return
  }
  setPrincipalFilter(filter)
}
</script>

<template>
  <div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
    <button
      v-for="chip in visibleFlagChips"
      :key="chip.key"
      type="button"
      :class="[
        'chip',
        'inline-flex items-center rounded-full border border-border px-3 py-1 text-sm transition-colors',
        state.chip.value === chip.key
          ? 'chip-active bg-foreground text-background'
          : 'chip-inactive bg-background text-foreground hover:bg-muted',
      ]"
      :data-chip="chip.key"
      :aria-pressed="state.chip.value === chip.key"
      @click="onFlagChipClick(chip.key)"
    >
      {{ chip.label }}
    </button>

    <button
      v-for="scope in scopeChips"
      :key="`scope-${scope.filter}`"
      type="button"
      :class="[
        'chip scope-chip',
        'inline-flex items-center rounded-full border border-border px-3 py-1 text-sm font-medium transition-colors',
        isScopeActive(scope.filter)
          ? 'chip-active bg-foreground text-background'
          : 'chip-inactive bg-background text-foreground hover:bg-muted',
      ]"
      :data-scope="scope.filter"
      :aria-pressed="isScopeActive(scope.filter)"
      @click="onScopeChipClick(scope.filter)"
    >
      <Icon
        v-if="scope.filter === 'mine'"
        name="user"
        class="h-3.5 w-3.5 mr-1"
      />
      <Icon
        v-else-if="scope.filter === 'all'"
        name="agents"
        class="h-3.5 w-3.5 mr-1"
      />
      <Icon
        v-else
        name="groups"
        class="h-3.5 w-3.5 mr-1"
      />
      {{ scope.label }}
    </button>

    <span class="filter-hint ml-auto text-[0.6875rem] text-muted-foreground max-sm:ml-0">
      Filters split between KPI cards (top) and chips (here).
    </span>
  </div>
</template>
