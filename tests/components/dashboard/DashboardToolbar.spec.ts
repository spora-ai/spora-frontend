/**
 * DashboardToolbar — verifies that typing in the search input calls
 * `setQuery` (debounced), that changing the sort `<select>` calls
 * `setSort`, and that the "Updated Xs ago" label re-renders against
 * `lastUpdatedAt` and the 5-second interval tick.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

import DashboardToolbar from '@/components/dashboard/DashboardToolbar.vue'

const queryRef = ref('')
const sortRef = ref<'activity' | 'name' | 'created' | 'tasks'>('activity')
const lastUpdatedAtRef = ref<Date | null>(null)
const setQuery = vi.fn()
const setSort = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    state: { chip: { value: 'all' }, query: queryRef, sort: sortRef },
    setQuery: (...args: unknown[]) => setQuery(...args),
    setSort: (...args: unknown[]) => setSort(...args),
    lastUpdatedAt: lastUpdatedAtRef,
  }),
}))

describe('DashboardToolbar', () => {
  beforeEach(() => {
    setQuery.mockClear()
    setSort.mockClear()
    queryRef.value = ''
    sortRef.value = 'activity'
    lastUpdatedAtRef.value = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the search input and a sort dropdown with the four options', () => {
    const wrapper = mount(DashboardToolbar)
    expect(wrapper.find('input[type="search"]').exists()).toBe(true)
    const options = wrapper.findAll('option')
    expect(options).toHaveLength(4)
    expect(options.map((o) => o.text())).toEqual([
      'Last activity',
      'Name',
      'Recent (Created proxy)',
      'Task count',
    ])
  })

  it('debounces the search input before calling setQuery', async () => {
    vi.useFakeTimers()
    const wrapper = mount(DashboardToolbar)
    const input = wrapper.find('input[type="search"]')

    await input.setValue('cal')
    // setQuery not called yet — the 200ms debounce hasn't elapsed.
    expect(setQuery).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    await flushPromises()

    expect(setQuery).toHaveBeenCalledTimes(1)
    expect(setQuery).toHaveBeenCalledWith('cal')
  })

  it('only calls setQuery with the final debounced value after rapid typing', async () => {
    vi.useFakeTimers()
    const wrapper = mount(DashboardToolbar)
    const input = wrapper.find('input[type="search"]')

    await input.setValue('c')
    vi.advanceTimersByTime(50)
    await input.setValue('ca')
    vi.advanceTimersByTime(50)
    await input.setValue('cal')
    // Each setValue resets the 200ms timer.
    vi.advanceTimersByTime(199)
    expect(setQuery).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(setQuery).toHaveBeenCalledTimes(1)
    expect(setQuery).toHaveBeenCalledWith('cal')
  })

  it('changing the sort dropdown calls setSort with the new key', async () => {
    const wrapper = mount(DashboardToolbar)
    const select = wrapper.find('select')

    await select.setValue('name')

    expect(setSort).toHaveBeenCalledTimes(1)
    expect(setSort).toHaveBeenCalledWith('name')
  })

  it('shows an empty "Updated …" label until lastUpdatedAt is set', () => {
    lastUpdatedAtRef.value = null
    const wrapper = mount(DashboardToolbar)
    expect(wrapper.find('.toolbar-updated').exists()).toBe(false)
  })

  it('renders the updated label against lastUpdatedAt (with tick updates)', async () => {
    vi.useFakeTimers()
    // Pretend lastUpdatedAt was 30 seconds ago at mount.
    const past = new Date('2026-07-15T10:00:00Z')
    vi.setSystemTime(new Date('2026-07-15T10:00:30Z'))
    lastUpdatedAtRef.value = past

    const wrapper = mount(DashboardToolbar)
    await flushPromises()

    expect(wrapper.find('.toolbar-updated').text()).toContain('30s ago')

    // Advance the 5s interval tick by 30s — label should bump to 1m ago.
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(wrapper.find('.toolbar-updated').text()).toContain('1m ago')
  })

  it('re-renders when lastUpdatedAt itself changes (refresh fired)', async () => {
    const first = new Date('2026-07-15T10:00:00Z')
    const later = new Date('2026-07-15T10:00:10Z')
    vi.useFakeTimers()
    vi.setSystemTime(later)
    lastUpdatedAtRef.value = first

    const wrapper = mount(DashboardToolbar)
    await flushPromises()
    expect(wrapper.find('.toolbar-updated').text()).toContain('10s ago')

    lastUpdatedAtRef.value = new Date(Date.now() - 5 * 1000)
    await nextTick()
    await flushPromises()
    expect(wrapper.find('.toolbar-updated').text()).toContain('5s ago')
  })
})
