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
import { usePrincipalsStore } from '@/stores/principals'
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
const principalsStore = usePrincipalsStore()

/** Group ids of every principal that owns at least one loaded agent. */
const groupIdsWithAgents = computed<number[]>(() => {
  const ids = new Set<number>()
  for (const agent of agentStore.agents) {
    if (agent.principal?.type === 'group' && agent.principal.group_id !== undefined) {
      ids.add(agent.principal.group_id)
    }
  }
  return Array.from(ids).sort((a, b) => a - b)
})

/** Label for a group principal id, falling back to `Group #N`. */
function groupLabel(groupId: number): string {
  const principal = principalsStore.principals.find(
    (p) => p.type === 'group' && p.group_id === groupId,
  )
  return principal?.name ?? `Group #${groupId}`
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
  <div class="filter-chips">
    <button
      v-for="chip in visibleFlagChips"
      :key="chip.key"
      type="button"
      :class="['chip', state.chip.value === chip.key ? 'chip-active' : 'chip-inactive']"
      :data-chip="chip.key"
      :aria-pressed="state.chip.value === chip.key"
      @click="onFlagChipClick(chip.key)"
    >
      {{ chip.label }}
    </button>

    <span v-if="scopeChips.length > 1" class="scope-divider" aria-hidden="true" />

    <button
      v-for="scope in scopeChips"
      :key="`scope-${scope.filter}`"
      type="button"
      :class="['chip', 'scope-chip', isScopeActive(scope.filter) ? 'chip-active' : 'chip-inactive']"
      :data-scope="scope.filter"
      :aria-pressed="isScopeActive(scope.filter)"
      @click="onScopeChipClick(scope.filter)"
    >
      <Icon v-if="scope.filter === 'mine'" name="user" class="h-3.5 w-3.5 mr-1" />
      <Icon v-else-if="scope.filter === 'all'" name="agents" class="h-3.5 w-3.5 mr-1" />
      <Icon v-else name="groups" class="h-3.5 w-3.5 mr-1" />
      {{ scope.label }}
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

.scope-divider {
  display: inline-block;
  width: 1px;
  height: 1.25rem;
  background: hsl(var(--border));
  margin: 0 0.25rem;
}

.scope-chip {
  /* Slight emphasis so the scope row reads as a distinct group from
     the flag chips to its left. */
  font-weight: 500;
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
  .scope-divider {
    display: none;
  }
}
</style>