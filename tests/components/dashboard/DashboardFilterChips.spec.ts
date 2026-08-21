/**
 * DashboardFilterChips — verifies that the chips render in order, that
 * the active chip is highlighted, and that clicking cycles through the
 * chip keys (with toggle-off behavior on the active chip). The Pinned
 * and Archived chips also disappear when no loaded agent carries the
 * corresponding flag. The Groups dropdown surfaces when at least one
 * loaded agent is owned by a group principal; selecting a group toggles
 * the principal filter via `setPrincipalFilter`.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'
import type { Agent } from '@/types/agent'

const chipRef = ref<'all' | 'pinned' | 'favorites' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')
const setChip = vi.fn()
const agentsRef = ref<Agent[]>([])
const selectedPrincipalIds = ref<number[]>([])
const setPrincipalFilter = vi.fn()

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
    selectedPrincipalIds,
    setPrincipalFilter: (...args: unknown[]) => setPrincipalFilter(...args),
  }),
}))

const principalsState: { principals: Array<Record<string, unknown>> } = { principals: [] }

vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => principalsState,
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

describe('DashboardFilterChips', () => {
  beforeEach(() => {
    chipRef.value = 'all'
    setChip.mockClear()
    setPrincipalFilter.mockClear()
    agentsRef.value = []
    selectedPrincipalIds.value = []
    principalsState.principals = []
  })

  it('renders all four chips when pinned, favorite, and archived agents exist', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Pinned Agent', is_pinned: true }),
      makeAgent({ id: 2, name: 'Favorite Agent', is_favorite: true }),
      makeAgent({ id: 3, name: 'Archived Agent', is_archived: true }),
    ]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips).toHaveLength(4)
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'pinned', 'favorites', 'archived'])
    expect(chips.map((c) => c.text())).toEqual(['All', 'Pinned', 'Favorites', 'Archived'])
  })

  it('hides the Pinned chip when no loaded agent has is_pinned=true', () => {
    agentsRef.value = [makeAgent({ id: 1, name: 'Plain', is_archived: true })]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'archived'])
    expect(chips.map((c) => c.text())).toEqual(['All', 'Archived'])
  })

  it('hides the Archived chip when no loaded agent has is_archived=true', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Plain' }),
      makeAgent({ id: 2, name: 'Pinned', is_pinned: true }),
    ]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'pinned'])
  })

  it('hides the Favorites chip when no loaded agent has is_favorite=true', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Pinned', is_pinned: true }),
      makeAgent({ id: 2, name: 'Archived', is_archived: true }),
    ]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'pinned', 'archived'])
  })

  it('hides both Pinned and Archived chips when no agent carries either flag', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Alpha' }),
      makeAgent({ id: 2, name: 'Beta' }),
    ]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.findAll('[data-chip]')).toHaveLength(1)
    expect(wrapper.find('[data-chip]').text()).toBe('All')
  })

  it('applies chip-active class only to the active chip', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'pinned'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips[0].classes()).not.toContain('chip-active')
    expect(chips[1].classes()).toContain('chip-active')
    expect(chips[2].classes()).not.toContain('chip-active')
    chipRef.value = 'all'
  })

  it('clicking an inactive chip calls setChip with its key', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)

    const chips = wrapper.findAll('[data-chip]')
    await chips[1].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('pinned')
  })

  it('clicking the active chip toggles back to "all"', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'archived'
    const wrapper = mount(DashboardFilterChips)

    const chips = wrapper.findAll('[data-chip]')
    await chips[2].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('all')
    chipRef.value = 'all'
  })

  it('cycles through All → Pinned → Favorites → Archived on successive clicks', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_favorite: true }),
      makeAgent({ id: 3, name: 'C', is_archived: true }),
    ]
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')

    await chips[0].trigger('click')
    await chips[1].trigger('click')
    await chips[2].trigger('click')
    await chips[3].trigger('click')

    expect(setChip.mock.calls).toEqual([
      ['all'],
      ['pinned'],
      ['favorites'],
      ['archived'],
    ])
  })

  it('hides the Groups dropdown when no loaded agent is owned by a group', () => {
    agentsRef.value = [makeAgent({ id: 1, name: 'Solo' })]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.find('.groups-control').exists()).toBe(false)
  })

  it('surfaces the Groups dropdown when at least one agent is group-owned', () => {
    agentsRef.value = [
      makeAgent({
        id: 1,
        name: 'Solo',
        principal: { id: 99, type: 'user', name: 'Me', user_id: 1, group_id: null },
      }),
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
    ]
    principalsState.principals = [
      { id: 99, type: 'user', name: 'Me', user_id: 1, group_id: null },
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.find('.groups-control').exists()).toBe(true)
  })

  it('clicking the Groups trigger opens the menu and lists one item per group', async () => {
    agentsRef.value = [
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
      makeAgent({
        id: 3,
        name: 'Ops Bot',
        principal: { id: 101, type: 'group', name: 'Operations', user_id: null, group_id: 9 },
      }),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      { id: 101, type: 'group', name: 'Operations', user_id: null, group_id: 9 },
    ]
    const wrapper = mount(DashboardFilterChips)
    await wrapper.find('.groups-trigger').trigger('click')
    const items = wrapper.findAll('.groups-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Engineering')
    expect(items[1].text()).toContain('Operations')
  })

  it('clicking a group item calls setPrincipalFilter with the new id array', async () => {
    agentsRef.value = [
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    await wrapper.find('.groups-trigger').trigger('click')
    await wrapper.findAll('.groups-item')[0].trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith([7])
  })

  it('clicking an already-selected group item removes it from the filter', async () => {
    selectedPrincipalIds.value = [7]
    agentsRef.value = [
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    await wrapper.find('.groups-trigger').trigger('click')
    await wrapper.findAll('.groups-item')[0].trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith([])
  })

  it('shows the Clear selection button when at least one group is selected', async () => {
    selectedPrincipalIds.value = [7]
    agentsRef.value = [
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    await wrapper.find('.groups-trigger').trigger('click')
    const clearBtn = wrapper.find('.groups-clear')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    expect(setPrincipalFilter).toHaveBeenCalledWith([])
  })

  it('renders the group count pill on the trigger', () => {
    selectedPrincipalIds.value = [7, 9]
    agentsRef.value = [
      makeAgent({
        id: 2,
        name: 'Eng Bot',
        principal: { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
      }),
    ]
    principalsState.principals = [
      { id: 100, type: 'group', name: 'Engineering', user_id: null, group_id: 7 },
    ]
    const wrapper = mount(DashboardFilterChips)
    expect(wrapper.find('.groups-count-pill').text()).toBe('2')
  })
})
