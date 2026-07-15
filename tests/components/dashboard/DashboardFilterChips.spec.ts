/**
 * DashboardFilterChips — verifies that the three chips render in order,
 * that the active chip is highlighted, and that clicking cycles through
 * the chip keys (with toggle-off behavior on the active chip).
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

import DashboardFilterChips from '@/components/dashboard/DashboardFilterChips.vue'

const chipRef = ref<'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')
const setChip = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    state: { chip: chipRef, query: { value: '' }, sort: { value: 'activity' } },
    setChip: (...args: unknown[]) => setChip(...args),
  }),
}))

describe('DashboardFilterChips', () => {
  it('renders three chips in All / Pinned / Archived order', () => {
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.attributes('data-chip'))).toEqual(['all', 'pinned', 'archived'])
    expect(chips.map((c) => c.text())).toEqual(['All', 'Pinned', 'Archived'])
  })

  it('applies chip-active class only to the active chip', () => {
    chipRef.value = 'pinned'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')
    expect(chips[0].classes()).not.toContain('chip-active')
    expect(chips[1].classes()).toContain('chip-active')
    expect(chips[2].classes()).not.toContain('chip-active')
    chipRef.value = 'all'
  })

  it('clicking an inactive chip calls setChip with its key', async () => {
    setChip.mockClear()
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)

    const chips = wrapper.findAll('[data-chip]')
    await chips[1].trigger('click') // pinned

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('pinned')
  })

  it('clicking the active chip toggles back to "all"', async () => {
    setChip.mockClear()
    chipRef.value = 'archived'
    const wrapper = mount(DashboardFilterChips)

    const chips = wrapper.findAll('[data-chip]')
    await chips[2].trigger('click') // already active

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('all')
    chipRef.value = 'all'
  })

  it('cycles through All → Pinned → Archived on successive clicks', async () => {
    setChip.mockClear()
    chipRef.value = 'all'
    const wrapper = mount(DashboardFilterChips)
    const chips = wrapper.findAll('[data-chip]')

    await chips[0].trigger('click') // active 'all' → no-op toggle to 'all'
    await chips[1].trigger('click') // pin
    await chips[2].trigger('click') // archive

    expect(setChip.mock.calls).toEqual([
      ['all'],
      ['pinned'],
      ['archived'],
    ])
  })
})
