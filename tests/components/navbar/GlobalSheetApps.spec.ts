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
        { name: 'plugins', displayName: 'Plugins', description: 'Manage plugins', icon: 'puzzle', accent: 'violet', route: '/apps/plugins' },
        { name: 'media-archive', displayName: 'Media Archive', description: 'Browse media', icon: 'image', accent: 'amber', route: '/apps/media-archive' },
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
        { name: 'plugins', displayName: 'Plugins', description: 'Manage plugins', icon: 'puzzle', accent: 'violet', route: '/apps/plugins' },
      ],
    })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    const tile = wrapper.find('button')
    await tile.trigger('click')
    expect(wrapper.emitted('navigate')?.[0]?.[0]).toMatchObject({ name: 'plugins' })
    wrapper.unmount()
  })

  it('applies the accent token from the server payload', async () => {
    apiGetMock.mockResolvedValue({
      apps: [
        { name: 'plugins', displayName: 'Plugins', description: 'x', icon: 'puzzle', accent: 'violet', route: '/apps/plugins' },
        { name: 'media-archive', displayName: 'Media', description: 'x', icon: 'image', accent: 'amber', route: '/apps/media-archive' },
        { name: 'memories', displayName: 'Memories', description: 'x', icon: 'brain', accent: 'emerald', route: '/apps/memories' },
        { name: 'typst', displayName: 'Typst', description: 'x', icon: 'pilcrow', accent: 'sky', route: '/apps/typst' },
      ],
    })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    const tiles = wrapper.findAll('button')
    const accentFor = (name: string): string | undefined =>
      tiles.find((t) => t.text().includes(name))?.classes()
        .find((c) => c.startsWith('from-'))
    expect(accentFor('Plugins')).toBe('from-violet-500/20')
    expect(accentFor('Media')).toBe('from-amber-500/20')
    expect(accentFor('Memories')).toBe('from-emerald-500/20')
    expect(accentFor('Typst')).toBe('from-sky-500/20')
    wrapper.unmount()
  })

  it('falls back to the primary classes when the accent token is unknown or missing', async () => {
    apiGetMock.mockResolvedValue({
      apps: [
        // Defensive coverage: AppsController already normalises unknown
        // tokens to 'primary' server-side, but the SPA renders defensively
        // too — a future payload drift must not break the navbar.
        { name: 'future', displayName: 'Future', description: 'x', icon: 'puzzle', accent: 'neon-pink', route: '/apps/future' },
        { name: 'legacy', displayName: 'Legacy', description: 'x', icon: 'puzzle', route: '/apps/legacy' },
      ],
    })
    const wrapper = mount(GlobalSheetApps)
    await flushPromises()
    const tiles = wrapper.findAll('button')
    const accentFor = (name: string): string | undefined =>
      tiles.find((t) => t.text().includes(name))?.classes()
        .find((c) => c.startsWith('from-'))
    expect(accentFor('Future')).toBe('from-primary/20')
    expect(accentFor('Legacy')).toBe('from-primary/20')
    wrapper.unmount()
  })
})
