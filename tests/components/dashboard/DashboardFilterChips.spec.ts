/**
 * DashboardFilterChips — verifies that the chips render in order, that
 * the active chip is highlighted, and that clicking cycles through the
 * chip keys (with toggle-off behavior on the active chip). The Pinned
 * and Archived chips also disappear when no loaded agent carries the
 * corresponding flag.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'
import type { Agent } from '@/types/agent'

const chipRef = ref<'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')
const setChip = vi.fn()
const agentsRef = ref<Agent[]>([])

const pinnedVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => (a as { is_pinned?: boolean }).is_pinned === true),
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
    archivedVisible,
  }),
}))

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'Alpha',
    description: null,
    system_prompt: null,
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
    agentsRef.value = []
  })

  it('renders all three chips when at least one agent is pinned and one is archived', () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Pinned Agent', is_pinned: true }),
      makeAgent({ id: 2, name: 'Archived Agent', is_archived: true }),
    ]
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'pinned', 'archived'])
    expect(chips.map((c) => c.text())).toEqual(['All', 'Pinned', 'Archived'])
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

  it('cycles through All → Pinned → Archived on successive clicks', async () => {
    agentsRef.value = [
      makeAgent({ id: 1, name: 'A', is_pinned: true }),
      makeAgent({ id: 2, name: 'B', is_archived: true }),
    ]
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')

    await chips[0].trigger('click')
    await chips[1].trigger('click')
    await chips[2].trigger('click')

    expect(setChip.mock.calls).toEqual([
      ['all'],
      ['pinned'],
      ['archived'],
    ])
  })
})
