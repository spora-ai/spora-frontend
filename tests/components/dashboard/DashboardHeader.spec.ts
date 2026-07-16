/**
 * DashboardHeader — verifies the title, the agent count copy, the
 * Refresh button (disabled while isRefreshing, otherwise calls refresh()),
 * and that "New agent" opens the create-dialog store with mode='choice'.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

import DashboardHeader from '@/components/dashboard/DashboardHeader.vue'

const agentsRef = ref<unknown[]>([])
const isRefreshingRef = ref(false)
const refreshMock = vi.fn()
const openMock = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    isRefreshing: isRefreshingRef,
    refresh: (...args: unknown[]) => refreshMock(...args),
  }),
}))

vi.mock('@/stores/createAgentDialog', () => ({
  useCreateAgentDialogStore: () => ({
    open: (...args: unknown[]) => openMock(...args),
  }),
}))

describe('DashboardHeader', () => {
  beforeEach(() => {
    refreshMock.mockClear()
    openMock.mockClear()
    agentsRef.value = []
    isRefreshingRef.value = false
  })

  it('renders the Agents title', () => {
    const wrapper = mount(DashboardHeader)
    expect(wrapper.find('.header-title').text()).toBe('Agents')
  })

  it('renders the singular copy when 1 agent exists', () => {
    agentsRef.value = [{ id: 1 }]
    const wrapper = mount(DashboardHeader)
    expect(wrapper.find('.header-subtitle').text()).toContain('1 agent')
  })

  it('renders the plural copy with multiple agents', () => {
    agentsRef.value = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const wrapper = mount(DashboardHeader)
    expect(wrapper.find('.header-subtitle').text()).toContain('3 agents')
  })

  it('the Refresh button calls refresh()', async () => {
    const wrapper = mount(DashboardHeader)
    await wrapper.find('.refresh-btn').trigger('click')
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('disables the Refresh button while isRefreshing is true', async () => {
    isRefreshingRef.value = true
    const wrapper = mount(DashboardHeader)
    const btn = wrapper.find('.refresh-btn')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toContain('Refreshing')

    await btn.trigger('click')
    // click on a disabled button is ignored at the DOM level — refresh
    // should remain uncalled.
    expect(refreshMock).not.toHaveBeenCalled()
    isRefreshingRef.value = false
  })

  it('the "New agent" button opens the create dialog in choice mode', async () => {
    const wrapper = mount(DashboardHeader)
    await wrapper.find('.new-agent-btn').trigger('click')
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith('choice')
  })
})
