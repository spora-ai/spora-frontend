/**
 * DashboardKpiStrip — verifies that the strip renders five KPI cards, that
 * clicking a card bubbles `select(kpiKey)` to the composable's `setChip`,
 * and that clicking the active card a second time resets the chip to
 * `'all'` (the toggle-off behavior described in the component spec).
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

import DashboardKpiStrip from '@/components/dashboard/DashboardKpiStrip.vue'

const chipRef = ref<'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'ABORTED' | 'SCHEDULED' | 'archived'>('all')
const kpiCountsRef = ref<{ agents: number; runningTasks: number; awaitingTasks: number; abortedTasks: number; scheduledToday: number }>({
  agents: 12, runningTasks: 2, awaitingTasks: 1, abortedTasks: 0, scheduledToday: 0,
})
const setChip = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    kpiCounts: kpiCountsRef,
    state: { chip: chipRef, query: { value: '' }, sort: { value: 'activity' } },
    setChip: (...args: unknown[]) => setChip(...args),
  }),
}))

describe('DashboardKpiStrip', () => {
  beforeEach(() => {
    kpiCountsRef.value = { agents: 12, runningTasks: 2, awaitingTasks: 1, abortedTasks: 0, scheduledToday: 0 }
    chipRef.value = 'all'
    setChip.mockClear()
  })

  it('renders five KPI cards in the prototype order', () => {
    const wrapper = mount(DashboardKpiStrip)
    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    expect(cards).toHaveLength(5)
    const keys = cards.map((c) => (c.props('kpiKey') as string))
    expect(keys).toEqual(['all', 'RUNNING', 'AWAITING', 'ABORTED', 'SCHEDULED'])
  })

  it('marks the card matching state.chip as active', () => {
    chipRef.value = 'RUNNING'
    const wrapper = mount(DashboardKpiStrip)
    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    const activeCount = cards.filter((c) => c.props('active') === true).length
    expect(activeCount).toBe(1)
    const active = cards.find((c) => c.props('active') === true)
    expect(active?.props('kpiKey')).toBe('RUNNING')
  })

  it('clicking a KPI calls setChip with its kpiKey', async () => {
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[1].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('RUNNING')
  })

  it('clicking the currently-active KPI calls setChip("all") to toggle off', async () => {
    chipRef.value = 'AWAITING'
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[2].trigger('click')

    expect(setChip).toHaveBeenCalledTimes(1)
    expect(setChip).toHaveBeenCalledWith('all')
  })

  it('clicking a different KPI calls setChip with that kpiKey (no toggle)', async () => {
    chipRef.value = 'RUNNING'
    const wrapper = mount(DashboardKpiStrip)

    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[4].trigger('click') // SCHEDULED

    expect(setChip).toHaveBeenCalledWith('SCHEDULED')
    expect(setChip).not.toHaveBeenCalledWith('all')
  })

  it('clicking the ABORTED KPI calls setChip with ABORTED', async () => {
    const wrapper = mount(DashboardKpiStrip)
    const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
    await cards[3].trigger('click') // ABORTED

    expect(setChip).toHaveBeenCalledWith('ABORTED')
  })

  describe('pulse-light visibility', () => {
    it('shows pulse on Running / Awaiting / Scheduled when their counts are > 0; Aborted pulse appears only when abortedTasks > 0', () => {
      kpiCountsRef.value = { agents: 12, runningTasks: 2, awaitingTasks: 1, abortedTasks: 4, scheduledToday: 3 }

      const wrapper = mount(DashboardKpiStrip)
      const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
      const pulses = cards.map((c) => c.props('pulseClass'))

      // 5 tiles now: Agents / Running / Awaiting / Aborted / Scheduled
      expect(pulses[0]).toBeNull()
      expect(pulses[1]).toBe('live')
      expect(pulses[2]).toBe('you')
      expect(pulses[3]).toBe('paused')
      expect(pulses[4]).toBe('soon')
    })

    it('hides the Scheduled and Aborted pulses when their counts are zero', () => {
      // kpiCountsRef already defaults to scheduledToday=0 / abortedTasks=0.
      const wrapper = mount(DashboardKpiStrip)
      const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
      expect(cards[0].props('pulseClass')).toBeNull()
      expect(cards[1].props('pulseClass')).toBe('live')    // runningTasks=2
      expect(cards[2].props('pulseClass')).toBe('you')     // awaitingTasks=1
      expect(cards[3].props('pulseClass')).toBeNull()     // abortedTasks=0
      expect(cards[4].props('pulseClass')).toBeNull()     // scheduledToday=0
    })

    it('hides all four state pulse lights when every count is zero', () => {
      kpiCountsRef.value = { agents: 5, runningTasks: 0, awaitingTasks: 0, abortedTasks: 0, scheduledToday: 0 }

      const wrapper = mount(DashboardKpiStrip)
      const cards = wrapper.findAllComponents({ name: 'DashboardKpiCard' })
      const pulses = cards.map((c) => c.props('pulseClass'))
      expect(pulses).toEqual([null, null, null, null, null])
    })
  })
})
