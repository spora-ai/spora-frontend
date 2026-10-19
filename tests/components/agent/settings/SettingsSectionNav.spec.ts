/**
 * SettingsSectionNav — in-page jump links for the agent settings sections.
 *
 * The behaviour worth pinning is the anchor ids, since they are set by
 * attribute fall-through on the page rather than by the section components.
 * A pill pointing at a section that does not exist is a dead link that
 * looks fine, so the ids are asserted against what the page actually renders.
 */
import { flushPromises, mount } from '@vue/test-utils'
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
    // Clicking a pill writes a fragment into the URL, and the component reads
    // `location.hash` on mount — so without this, one test's pill click
    // decides the next test's active section.
    window.history.replaceState(null, '', '/')
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

  it('follows a manual scroll', async () => {
    // The behaviour the observer alone gets wrong: it only reports sections
    // whose intersection changed, so it says nothing while the reader scrolls
    // within a card, and the pill would keep a stale value.
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true })
    scroller.scrollTop = 0
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect

    // Ids must match the `sections` the component is rendered with, and every
    // one of them must exist in the DOM or the geometry pass skips it.
    const tops: Record<string, number> = { identity: 0, llm: 500, 'api-keys': 1000, danger: 1500 }
    for (const [id, top] of Object.entries(tops)) {
      const el = document.createElement('section')
      el.id = id
      el.getBoundingClientRect = () => ({ top: top - scroller.scrollTop }) as DOMRect
      scroller.appendChild(el)
    }

    document.body.appendChild(scroller)
    const wrapper = render()
    await flushPromises()

    const pills = () => wrapper.findAll('nav a')
    expect(pills()[0].attributes('aria-current')).toBe('true')

    // Scroll down past LLM and fire a scroll event, as a wheel would.
    scroller.scrollTop = 500
    scroller.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(pills()[1].attributes('aria-current')).toBe('true')
    expect(pills()[0].attributes('aria-current')).toBeUndefined()

    scroller.scrollTop = 1000
    scroller.dispatchEvent(new Event('scroll'))
    await flushPromises()

    expect(pills()[2].attributes('aria-current')).toBe('true')

    scroller.remove()
  })

  it('lights the last section when the page is scrolled to the bottom', async () => {
    // The last card can never reach the line — there is not enough content
    // below it — so without this the final pill is unreachable.
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(scroller, 'scrollHeight', { value: 700, configurable: true })
    scroller.scrollTop = 0
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect

    const tops: Record<string, number> = { identity: 600, llm: 1400, 'api-keys': 1800, danger: 2000 }
    for (const [id, top] of Object.entries(tops)) {
      const el = document.createElement('section')
      el.id = id
      el.getBoundingClientRect = () => ({ top: top - scroller.scrollTop }) as DOMRect
      scroller.appendChild(el)
    }
    document.body.appendChild(scroller)

    const wrapper = render()
    await flushPromises()

    scroller.scrollTop = 300
    scroller.dispatchEvent(new Event('scroll'))
    await flushPromises()

    // The last pill, not the last section that crossed the line.
    expect(wrapper.findAll('nav a')[3].attributes('aria-current')).toBe('true')

    scroller.remove()
  })

  it('does not throw when a pill targets a section that is not rendered', async () => {
    // The observer skips missing elements, and so must the click handler —
    // otherwise toggling the feature off mid-run would break the nav.
    const wrapper = render()

    expect(() => wrapper.findAll('nav a')[2].trigger('click')).not.toThrow()
    // Asserted on an observable, not on a detached element: a pill for an
    // unrendered section must be a no-op, not an exception and not a scroll.
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('lands a deep link on a section the nav does not list', async () => {
    // The API keys section renders whether or not the feature is on, so the
    // page can always revoke a key it minted earlier. When the feature is
    // off the pill is gone, which left the nav resolving `#api-keys` against
    // its own link list and ignoring a bookmark that was perfectly valid.
    const target = document.createElement('section')
    target.id = 'api-keys'
    target.getBoundingClientRect = () => ({ top: 500 }) as DOMRect
    document.body.appendChild(target)

    window.history.replaceState(null, '', '/agents/7/settings#api-keys')
    render({ sections: sections.filter((section) => section.id !== 'api-keys') })

    await flushPromises()
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 404, behavior: 'auto' })
    document.body.removeChild(target)
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
