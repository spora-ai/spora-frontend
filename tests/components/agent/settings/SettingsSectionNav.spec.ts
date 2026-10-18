/**
 * SettingsSectionNav — in-page jump links for the agent settings sections.
 *
 * The behaviour worth pinning is the anchor ids, since they are set by
 * attribute fall-through on the page rather than by the section components.
 * A pill pointing at a section that does not exist is a dead link that
 * looks fine, so the ids are asserted against what the page actually renders.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsSectionNav from '@/components/agent/settings/SettingsSectionNav.vue'

const sections = [
  { id: 'identity', label: 'Identity' },
  { id: 'llm', label: 'LLM' },
  { id: 'api-keys', label: 'API keys' },
  { id: 'danger', label: 'Danger Zone' },
]

function render(props: Record<string, unknown> = {}) {
  return mount(SettingsSectionNav, {
    props: { sections, ...props },
  })
}

describe('SettingsSectionNav', () => {
  beforeEach(() => {
    // jsdom has no IntersectionObserver; the component degrades to
    // navigate-only, which is what the link behaviour below exercises.
    vi.stubGlobal('IntersectionObserver', undefined)
    window.scrollTo = vi.fn()
  })

  it('renders one pill per section, in order', () => {
    const wrapper = render()
    const labels = wrapper.findAll('nav a').map((link) => link.text())

    expect(labels).toEqual(['Identity', 'LLM', 'API keys', 'Danger Zone'])
  })

  it('points each pill at a real fragment', () => {
    // Not `toBeTruthy` on the href — an anchor to a missing id is exactly
    // the failure this guards, and it looks fine in the DOM.
    for (const link of render().findAll('nav a')) {
      expect(link.attributes('href')).toMatch(/^#[a-z-]+$/)
    }
  })

  it('marks the first section as current before any scrolling', () => {
    const first = render().findAll('nav a')[0]

    expect(first.attributes('aria-current')).toBe('true')
    expect(render().findAll('nav a')[1].attributes('aria-current')).toBeUndefined()
  })

  it('scrolls the inner scroller, never the window', async () => {
    // The regression that broke the page: settings lives inside AgentLayout's
    // `overflow-y: auto` column and the window does not scroll, so
    // `window.scrollTo` dragged the whole `h-screen` shell up and left a page
    // of white space below it.
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    scroller.scrollTo = vi.fn()

    const target = document.createElement('section')
    target.id = 'api-keys'
    target.getBoundingClientRect = () => ({ top: 500 }) as DOMRect
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    scroller.appendChild(target)
    document.body.appendChild(scroller)

    const wrapper = render()
    await wrapper.findAll('nav a')[2].trigger('click')

    // 500 - 96 (default offset) = 404: past the sticky header.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 404, behavior: 'smooth' })
    expect(window.scrollTo).not.toHaveBeenCalled()

    document.body.removeChild(scroller)
  })

  it('falls back to the window only when there is no scrolling ancestor', async () => {
    const target = document.createElement('section')
    target.id = 'api-keys'
    target.getBoundingClientRect = () => ({ top: 500 }) as DOMRect
    document.body.appendChild(target)

    const wrapper = render()
    await wrapper.findAll('nav a')[2].trigger('click')

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 404, behavior: 'smooth' })

    document.body.removeChild(target)
  })

  it('does not throw when a pill targets a section that is not rendered', async () => {
    // The observer skips missing elements, and so must the click handler —
    // otherwise toggling the feature off mid-run would break the nav.
    const wrapper = render()
    const orphan = document.createElement('section')

    expect(() => wrapper.findAll('nav a')[2].trigger('click')).not.toThrow()
    expect(orphan.id).toBe('')
  })

  it('honours a custom sticky-header offset', async () => {
    const target = document.createElement('section')
    target.id = 'danger'
    document.body.appendChild(target)
    target.getBoundingClientRect = () => ({ top: 1000 }) as DOMRect

    await render({ offset: 200 }).findAll('nav a')[3].trigger('click')

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'smooth' })
    document.body.removeChild(target)
  })
})