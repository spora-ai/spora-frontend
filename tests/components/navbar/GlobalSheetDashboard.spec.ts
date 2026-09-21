/**
 * GlobalSheetDashboard — single tile linking to the operator dashboard.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>', props: ['to'] },
}))

import GlobalSheetDashboard from '@/components/navbar/GlobalSheetDashboard.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  pushMock.mockReset()
})

describe('GlobalSheetDashboard', () => {
  it('renders the Dashboard label and subtitle', () => {
    const wrapper = mount(GlobalSheetDashboard)
    expect(wrapper.text()).toContain('Dashboard')
    expect(wrapper.text()).toContain('View all agents at a glance')
    wrapper.unmount()
  })

  it('navigates to the dashboard route on click', async () => {
    const wrapper = mount(GlobalSheetDashboard)
    await wrapper.find('button').trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'dashboard' })
    wrapper.unmount()
  })
})
