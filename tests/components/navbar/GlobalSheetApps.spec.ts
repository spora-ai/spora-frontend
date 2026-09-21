/**
 * GlobalSheetApps — apps grid in the navbar sheet.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: { get: apiGetMock },
}))

import GlobalSheetApps from '@/components/navbar/GlobalSheetApps.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  apiGetMock.mockReset()
})

describe('GlobalSheetApps', () => {
  it('fetches /apps on mount', async () => {
    apiGetMock.mockResolvedValue({ apps: [] })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    expect(apiGetMock).toHaveBeenCalledWith('/apps')
    wrapper.unmount()
  })

  it('renders app tiles from the response', async () => {
    apiGetMock.mockResolvedValue({
      apps: [
        { name: 'plugins', displayName: 'Plugins', description: 'Manage plugins', icon: 'puzzle', route: '/apps/plugins' },
        { name: 'media-archive', displayName: 'Media Archive', description: 'Browse media', icon: 'image', route: '/apps/media-archive' },
      ],
    })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    expect(wrapper.text()).toContain('Plugins')
    expect(wrapper.text()).toContain('Media Archive')
    wrapper.unmount()
  })

  it('shows "No apps installed" when the response is empty', async () => {
    apiGetMock.mockResolvedValue({ apps: [] })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    expect(wrapper.text()).toContain('No apps installed')
    wrapper.unmount()
  })

  it('clears the list on /apps failure', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    expect(wrapper.text()).toContain('No apps installed')
    wrapper.unmount()
  })

  it('emits navigate with the clicked app', async () => {
    apiGetMock.mockResolvedValue({
      apps: [
        { name: 'plugins', displayName: 'Plugins', description: 'Manage plugins', icon: 'puzzle', route: '/apps/plugins' },
      ],
    })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    const tile = wrapper.find('button')
    await tile.trigger('click')
    expect(wrapper.emitted('navigate')?.[0]?.[0]).toMatchObject({ name: 'plugins' })
    wrapper.unmount()
  })
})
