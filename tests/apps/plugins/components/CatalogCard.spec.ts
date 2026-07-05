/**
 * CatalogCard — single Packagist entry on the Browse tab.
 *
 * Verifies the rendered package metadata (name, version, description,
 * download + favorite counts), the Packagist link target, and the
 * copy-to-clipboard behaviour (text is copied, label flips to "Copied",
 * then resets after the 1500 ms timeout).
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
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    const text = wrapper.text()
    expect(text).toContain('spora-ai/spora-plugin-email')
    expect(text).toContain('0.2.1')
    expect(text).toContain('IMAP/SMTP for Spora')
  })

  it('omits the version line when the entry has no version', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, version: null } },
    })
    expect(wrapper.text()).not.toContain('0.2.1')
  })

  it('falls back to a generic placeholder when the entry has no description', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, description: '' } },
    })
    expect(wrapper.text()).toContain('No description provided.')
  })

  it('formats downloads and favorites with locale grouping', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, downloads: 1234567, favorites: 4321 } },
    })
    const text = wrapper.text()
    expect(text).toContain('1,234,567')
    expect(text).toContain('4,321')
  })

  it('hides the stats block when both downloads and favorites are zero', () => {
    const wrapper = mount(CatalogCard, {
      props: { entry: { ...baseEntry, downloads: 0, favorites: 0 } },
    })
    // No ↓ or ★ counters visible.
    expect(wrapper.text()).not.toContain('↓')
    expect(wrapper.text()).not.toContain('★')
  })
})

describe('CatalogCard — Packagist link', () => {
  it('renders a Packagist link pointing at the canonical package URL', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    const link = wrapper.find(`[data-testid="packagist-${baseEntry.name}"]`)
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(`https://packagist.org/packages/${baseEntry.name}`)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })
})

describe('CatalogCard — copy-to-clipboard', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
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

  it('copies the package name when the button is clicked', async () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    const button = wrapper.find(`[data-testid="copy-${baseEntry.name}"]`)
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Copy name')

    await button.trigger('click')
    // writeText returns a promise; let it resolve.
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith(baseEntry.name)
    expect(button.text()).toContain('Copied')
  })

  it('reverts the "Copied" label to "Copy name" after 1500ms', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    const button = wrapper.find(`[data-testid="copy-${baseEntry.name}"]`)

    await button.trigger('click')
    // Let the microtask flush so `copied.value = true` settles.
    await Promise.resolve()
    expect(button.text()).toContain('Copied')

    vi.advanceTimersByTime(1500)
    await Promise.resolve()
    expect(button.text()).toContain('Copy name')
  })

  it('swallows clipboard errors silently and keeps the button label untouched', async () => {
    writeText.mockRejectedValueOnce(new Error('blocked'))
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    const button = wrapper.find(`[data-testid="copy-${baseEntry.name}"]`)

    await button.trigger('click')
    // Allow the try/catch to settle.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(writeText).toHaveBeenCalled()
    expect(button.text()).toContain('Copy name')
  })
})

describe('CatalogCard — testid attr', () => {
  it('uses the package name in the card testid', () => {
    const wrapper = mount(CatalogCard, { props: { entry: baseEntry } })
    expect(wrapper.attributes('data-testid')).toBe(`catalog-card-${baseEntry.name}`)
  })
})
