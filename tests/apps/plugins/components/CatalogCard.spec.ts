/**
 * CatalogCard — rendered package metadata + the admin-gated Install button.
 *
 * The card used to expose a "Copy name" button that wrote the package name
 * to the clipboard. With the in-card Install flow, an admin (and only an
 * admin + plugin_install feature-flag) sees an Install affordance that
 * bubbles `install(pkg)` up to the BrowseStorePanel.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import CatalogCard from '@/apps/plugins/components/CatalogCard.vue'
import type { CatalogEntry } from '@/apps/plugins/types/plugin'

const baseEntry: CatalogEntry = {
  name: 'spora-ai/spora-plugin-email',
  description: 'IMAP/SMTP for Spora',
  version: '0.2.1',
  downloads: 1234,
  favorites: 12,
  repository: 'https://github.com/spora-ai/spora-plugin-email',
  homepage: null,
}

describe('CatalogCard — metadata rendering', () => {
  it('renders the package name, version, and description', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: false } })
    const text = wrapper.text()
    expect(text).toContain('spora-ai/spora-plugin-email')
    expect(text).toContain('0.2.1')
    expect(text).toContain('IMAP/SMTP for Spora')
  })

  it('omits the version line when the entry has no version', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, version: null }, showInstallButton: false },
    })
    expect(wrapper.text()).not.toContain('0.2.1')
  })

  it('falls back to a generic placeholder when the entry has no description', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, description: '' }, showInstallButton: false },
    })
    expect(wrapper.text()).toContain('No description provided.')
  })

  it('formats downloads and favorites with locale grouping', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, downloads: 1234567, favorites: 4321 }, showInstallButton: false },
    })
    const text = wrapper.text()
    expect(text).toContain('1,234,567')
    expect(text).toContain('4,321')
  })

  it('hides the stats block when both downloads and favorites are zero', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, downloads: 0, favorites: 0 }, showInstallButton: false },
    })
    // No ↓ or ★ counters visible.
    expect(wrapper.text()).not.toContain('↓')
    expect(wrapper.text()).not.toContain('★')
  })
})

describe('CatalogCard — Packagist link', () => {
  it('renders a Packagist link pointing at the canonical package URL', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: false } })
    const link = wrapper.find(`[data-testid="packagist-${baseEntry.name}"]`)
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(`https://packagist.org/packages/${baseEntry.name}`)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })
})

describe('CatalogCard — Install button', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Defensive — CatalogCard no longer touches the clipboard, but if a
    // test accidentally re-introduces a writeText call we want to know.
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not render the Install button when showInstallButton is false', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: false } })
    expect(wrapper.find(`[data-testid="install-${baseEntry.name}"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Install')
  })

  it('renders the Install button when showInstallButton is true', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: true } })
    const button = wrapper.find(`[data-testid="install-${baseEntry.name}"]`)
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Install')
  })

  it('emits "install" with the package name when the Install button is clicked', async () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: true } })
    const button = wrapper.find(`[data-testid="install-${baseEntry.name}"]`)
    await button.trigger('click')
    expect(wrapper.emitted('install')).toBeTruthy()
    expect(wrapper.emitted('install')![0]).toEqual([baseEntry.name])
  })

  it('does not call navigator.clipboard.writeText (clipboard is the parent\'s concern)', async () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: true } })
    const button = wrapper.find(`[data-testid="install-${baseEntry.name}"]`)
    await button.trigger('click')
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('CatalogCard — testid attr', () => {
  it('uses the package name in the card testid', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry, showInstallButton: false } })
    expect(wrapper.attributes('data-testid')).toBe(`catalog-card-${baseEntry.name}`)
  })
})
