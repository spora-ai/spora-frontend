/**
 * DashboardKpiStrip — verifies that the strip renders four KPI cards, that
 * clicking a card bubbles `select(kpiKey)` to the composable's `setChip`,
 * and that clicking the active card a second time resets the chip to
 * `'all'` (the toggle-off behavior described in the component spec).
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

import DashboardKpiStrip from '@/components/dashboard/DashboardKpiStrip.vue'

const chipRef = ref<'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')
const setChip = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    kpiCounts: { value: { agents: 12, runningTasks: 2, awaitingTasks: 1, scheduledToday: 0 } },
    state: { chip: chipRef, query: { value: '' }, sort: { value: 'activity' } },
    setChip: (...args: unknown[]) => setChip(...args),
  }),
}))

describe('DashboardKpiStrip', () => {
  it('renders four KPI cards in the prototype order', () => {
    const wrapper = mount(DashboardKpiStrip)
    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    expect(cards).toHaveLength(4)
    const keys = cards.map((c) => (c.props('kpiKey') as string))
    expect(keys).toEqual(['all', 'RUNNING', 'AWAITING', 'SCHEDULED'])
  })

  it('marks the card matching state.chip as active', () => {
    chipRef.value = 'RUNNING'
    const wrapper = mount(DashboardKpiStrip)
    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    const activeCount = cards.filter((c) => c.props('active') === true).length
    expect(activeCount).toBe(1)
    const active = cards.find((c) => c.props('active') === true)
    expect(active?.props('kpiKey')).toBe('RUNNING')
    chipRef.value = 'all'
  })

  it('clicking a KPI calls setChip with its kpiKey', async () => {
    setChip.mockClear()
    chipRef.value = 'all'
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[1].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('RUNNING')
  })

  it('clicking the currently-active KPI calls setChip("all") to toggle off', async () => {
    setChip.mockClear()
    chipRef.value = 'AWAITING'
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    // cards[2] is the AWAITING tile.
    await cards[2].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('all')
  })

  it('clicking a different KPI calls setChip with that kpiKey (no toggle)', async () => {
    setChip.mockClear()
    chipRef.value = 'RUNNING'
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[3].trigger('click') // SCHEDULED

    expect(setChip).toHaveBeenCalledWith('SCHEDULED')
    expect(setChip).not.toHaveBeenCalledWith('all')
    chipRef.value = 'all'
  })
})
