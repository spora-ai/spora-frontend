/**
 * DashboardFilterChips — verifies the chip row's two halves:
 *   1. Flag chips (All / Pinned / Favorites / Archived) — toggle to
 *      `useDashboardData().setChip` with toggle-off behaviour.
 *   2. Scope chips (All / My Agents / Group A / Group B / ...) — flat
 *      single-select strip. Clicking a chip sets the principal-scope
 *      filter to the chip's value; clicking the active chip resets
 *      to 'all'.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'
import type { Agent } from '@/types/agent'
import type { PrincipalFilter } from '@/composables/useDashboardData'

const chipRef = ref<'all' | 'pinned' | 'favorites' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')
const setChip = vi.fn()
const agentsRef = ref<Agent[]>([])
const selectedPrincipalFilter = ref<PrincipalFilter>('all')
const setPrincipalFilter = vi.fn()
const callerPrincipalId = ref<number | null>(99)

const pinnedVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => (a as { is_pinned?: boolean }).is_pinned === true),
)
const favoritesVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => a.is_favorite === true),
)
const archivedVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => (a as { is_archived?: boolean }).is_archived === true),
)

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    state: { chip: chipRef, query: { value: '' }, sort: { value: 'activity' } },
    setChip: (...args: unknown[]) => setChip(...args),
    agents: agentsRef,
    pinnedVisible,
    favoritesVisible,
    archivedVisible,
    selectedPrincipalFilter,
    setPrincipalFilter: (...args: unknown[]) => setPrincipalFilter(...args),
    callerPrincipalId,
  }),
}))

const principalsState: { principals: Array<Record<string, unknown>> } = { principals: [] }

vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => principalsState,
}))

const authState: { user: { id: number; name: string } | null } = {
  user: { id: 1, name: 'Test User' },
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({ agents: agentsRef.value }),
}))

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'Alpha',
    description: null,
    system_prompt: null,
    principal_id: 1,
    principal: null,
    llm_driver_config_id: null,
    max_steps: 5,
    is_active: true,
    tools: [],
    ...overrides,
  }
}

function groupAgent(id: number, name: string, groupPrincipalId: number, groupId: number): Agent {
  return makeAgent({
    id,
    name,
    principal_id: groupPrincipalId,
    principal: { id: groupPrincipalId, type: 'group', name, user_id: null, group_id: groupId },
  })
}

function userAgent(id: number, name: string, userPrincipalId: number): Agent {
  return makeAgent({
    id,
    name,
    principal_id: userPrincipalId,
    principal: { id: userPrincipalId, type: 'user', name, user_id: 1, group_id: null },
  })
}

describe('DashboardFilterChips', () => {
  beforeEach(() => {
    chipRef.value = 'all'
    setChip.mockClear()
    setPrincipalFilter.mockClear()
    agentsRef.value = []
    selectedPrincipalFilter.value = 'all'
    callerPrincipalId.value = 99
    principalsState.principals = []
    authState.user = { id: 1, name: 'Test User' }
  })

  // -- flag chips (left side) -----------------------------------------

  it('renders only the three flag chips (no "All" — that lives on the scope row now)', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Pinned Agent', is_pinned: true }),
      makeAgent({ id: 2, name: 'Favorite Agent', is_favorite: true }),
      makeAgent({ id: 3, name: 'Archived Agent', is_archived: true }),
    ]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['pinned', 'favorites', 'archived'])
    expect(chips.map((c) => c.text())).toEqual(['Pinned', 'Favorites', 'Archived'])
  })

  it('hides the Pinned chip when no loaded agent has is_pinned=true', () => {
    agentsRef.value = [makeAgent({ id: 1, name: 'Plain', is_archived: true })]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.findAll('[data-chip]').map((c) => c.attributes('data-chip'))).toEqual(['archived'])
  })

  it('renders no flag chips when no agent carries any flag', () => {
    agentsRef.value = [makeAgent({ id: 1, name: 'Plain' })]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.findAll('[data-chip]')).toHaveLength(0)
  })

  it('applies chip-active class only to the active flag chip', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'pinned'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips[0].classes()).toContain('chip-active')
    expect(chips[1].classes()).not.toContain('chip-active')
  })

  it('clicking an inactive flag chip calls setChip with its key', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    await chips[0].trigger('click')
    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('pinned')
  })

  it('clicking the active flag chip toggles back to "all"', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'archived'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    // Both Pinned and Archived are visible (Favorites hidden because no
    // favoritesVisible=false). The Archived chip is at index 1.
    await chips[1].trigger('click')
    expect(setChip).toHaveBeenCalledWith('all')
  })

  // -- scope chips (right side) ----------------------------------------

  it('renders only the All scope chip when the caller has no group-owned agents and no user-principal', () => {
    callerPrincipalId.value = null
    agentsRef.value = [userAgent(1, 'Solo', 99)]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips).toHaveLength(1)
    expect(scopeChips[0].attributes('data-scope')).toBe('all')
    expect(scopeChips[0].text()).toBe('All')
  })

  it('renders All + My Agents when the caller has a user-principal and at least one user-owned agent', () => {
    callerPrincipalId.value = 99
    agentsRef.value = [userAgent(1, 'Solo', 99)]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips.map((c) => c.attributes('data-scope'))).toEqual(['all', 'mine'])
    expect(scopeChips[1].text()).toBe('My Agents (Test User)')
  })

  it('appends one scope chip per group that owns at least one loaded agent', () => {
    agentsRef.value = [
      userAgent(1, 'Solo', 99),
      groupAgent(2, 'Engineering', 100, 7),
      groupAgent(3, 'Operations', 101, 9),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      { id: 101, type: 'group', name: 'Operations', user_id: null, group_id: 9 },
    ]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips.map((c) => c.attributes('data-scope'))).toEqual(['all', 'mine', '7', '9'])
    expect(scopeChips[2].text()).toBe('Engineering')
    expect(scopeChips[3].text()).toBe('Operations')
  })

  it('falls back to "Group #N" when the principal is missing from the store', () => {
    callerPrincipalId.value = null
    agentsRef.value = [groupAgent(2, 'Unmapped', 100, 7)]
    // principals store is empty — group 7 has no Principal row.
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips[1].text()).toBe('Group #7')
  })

  it('orders scope chips deterministically by group id', () => {
    callerPrincipalId.value = null
    agentsRef.value = [
      groupAgent(3, 'B', 101, 9),
      groupAgent(1, 'A', 100, 7),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'A', user_id: null, group_id: 7 },
      { id: 101, type: 'group', name: 'B', user_id: null, group_id: 9 },
    ]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips.map((c) => c.attributes('data-scope'))).toEqual(['all', '7', '9'])
  })

  it('applies chip-active to the currently selected scope chip', () => {
    agentsRef.value = [userAgent(1, 'Solo', 99), groupAgent(2, 'Eng', 100, 7)]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Eng', user_id: null, group_id: 7 },
    ]
    selectedPrincipalFilter.value = 7
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips[0].classes()).not.toContain('chip-active')
    expect(scopeChips[1].classes()).not.toContain('chip-active')
    expect(scopeChips[2].classes()).toContain('chip-active')
  })

  it('clicking a scope chip calls setPrincipalFilter with the chip value', async () => {
    agentsRef.value = [userAgent(1, 'Solo', 99), groupAgent(2, 'Eng', 100, 7)]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Eng', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    // Click "My Agents" (index 1 — 'mine')
    await scopeChips[1].trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith('mine')
    // Click the group chip (index 2 — groupId 7)
    await scopeChips[2].trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith(7)
  })

  it('clicking the active scope chip resets to "all" (toggle-off)', async () => {
    agentsRef.value = [userAgent(1, 'Solo', 99), groupAgent(2, 'Eng', 100, 7)]
    selectedPrincipalFilter.value = 'mine'
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    await scopeChips[1].trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith('all')
  })

  it('single-select: clicking a different scope replaces the current one (no toggling)', async () => {
    agentsRef.value = [userAgent(1, 'Solo', 99), groupAgent(2, 'Eng', 100, 7), groupAgent(3, 'Ops', 101, 9)]
    selectedPrincipalFilter.value = 7
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    await scopeChips[1].trigger('click') // 'mine'
    expect(setPrincipalFilter).toHaveBeenLastCalledWith('mine')
    await scopeChips[3].trigger('click') // group 9
    expect(setPrincipalFilter).toHaveBeenLastCalledWith(9)
  })

  it('omits the My Agents chip when callerPrincipalId is null (no user-principal row)', () => {
    callerPrincipalId.value = null
    agentsRef.value = [groupAgent(2, 'Eng', 100, 7)]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Eng', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    const scopeChips = wrapper.findAll('[data-scope]')
    expect(scopeChips.map((c) => c.attributes('data-scope'))).toEqual(['all', '7'])
  })
})