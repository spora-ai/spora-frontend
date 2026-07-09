/**
 * SelectionBubble — selection-only formatting popover.
 *
 * The popover Teleports into document.body, so we look for the rendered DOM
 * via `document.querySelector` rather than `wrapper.find` (which only sees
 * the component's own slot tree).
 *
 * Test cleanup matters here: each mount registers a `selectionchange` listener
 * on document that survives across tests. We track wrappers in a registry
 * and unmount them in `beforeEach` so a stale component never tries to
 * patch into a DOM node we have since removed.
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import SelectionBubble from '@/components/SelectionBubble.vue'

let host: HTMLDivElement
let target: HTMLDivElement
const wrappers: VueWrapper[] = []

function mountBubble(props: Record<string, unknown>): VueWrapper {
  // The component expects a `getTarget` getter so it can re-resolve the
  // contenteditable surface on every selectionchange event (the live editor
  // swaps nodes on theme / value updates).
  const merged: Record<string, unknown> = {
    getTarget: () => target,
    ...props,
  }
  const w = mount(SelectionBubble, {
    props: merged as { getTarget: () => HTMLElement | null },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

function makeEditable(): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('contenteditable', 'true')
  el.textContent = 'hello world'
  host.appendChild(el)
  return el
}

function selectRange(el: HTMLDivElement, start: number, end: number): void {
  const range = document.createRange()
  range.setStart(el.firstChild!, start)
  range.setEnd(el.firstChild!, end)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  // happy-dom doesn't reliably fire `selectionchange` on programmatic range
  // mutation; dispatch it manually. In real browsers this happens automatically.
  document.dispatchEvent(new Event('selectionchange'))
}

function findPopover(): HTMLElement | null {
  return document.querySelector('.md-selection-bubble')
}

beforeEach(() => {
  // Unmount any wrappers left over from the previous test before yanking
  // their Teleport targets out of the DOM.
  for (const w of wrappers.splice(0)) w.unmount()

  window.getSelection()?.removeAllRanges()
  document.querySelectorAll('.md-selection-bubble').forEach((el) => el.remove())

  if (!host) {
    host = document.createElement('div')
    host.id = 'selection-bubble-test-host'
    document.body.appendChild(host)
  }
  host.innerHTML = ''
  target = makeEditable()
})

describe('SelectionBubble', () => {
  it('does not render when there is no selection', () => {
    mountBubble({ target })
    expect(findPopover()).toBeNull()
  })

  it('renders when text inside the target is selected', async () => {
    mountBubble({})
    selectRange(target, 0, 5) // 'hello'
    await nextTick()
    expect(findPopover()).not.toBeNull()
  })

  it('hides again when the selection is collapsed', async () => {
    mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    expect(findPopover()).not.toBeNull()

    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await nextTick()
    expect(findPopover()).toBeNull()
  })

  it('does not render when selection is outside the target', async () => {
    const other = document.createElement('p')
    other.textContent = 'outside'
    host.appendChild(other)

    mountBubble({})
    const range = document.createRange()
    range.setStart(other.firstChild!, 0)
    range.setEnd(other.firstChild!, 7)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await nextTick()
    expect(findPopover()).toBeNull()
  })

  it('re-resolves the target on each selection event (live editor swap)', async () => {
    // Regression for the SonarCloud reliability flag: md-editor-v3 swaps
    // its contenteditable surface internally, so the popover must re-query
    // the live node on every selectionchange instead of caching one ref.
    let live = target
    const wrapper = mountBubble({ getTarget: () => live })
    selectRange(target, 0, 5)
    await nextTick()
    expect(findPopover()).not.toBeNull()

    // Replace the contenteditable (simulating the library's internal swap).
    const replacement = document.createElement('div')
    replacement.setAttribute('contenteditable', 'true')
    replacement.textContent = 'swapped'
    host.replaceChild(replacement, target)
    live = replacement
    // The previous selection is now in a detached node; make a new one
    // inside the replacement so the live lookup finds it.
    selectRange(replacement, 0, 3)
    await nextTick()
    expect(findPopover()).not.toBeNull()
    wrapper.unmount()
  })

  it('emits format with bold when the bold button is clicked', async () => {
    const wrapper = mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    const boldBtn = findPopover()!.querySelector('button[title^="Bold"]')!
    boldBtn.click()
    expect(wrapper.emitted('format')?.[0]).toEqual(['bold'])
  })

  it('emits format with italic when the italic button is clicked', async () => {
    const wrapper = mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    const btn = findPopover()!.querySelector('button[title^="Italic"]')!
    btn.click()
    expect(wrapper.emitted('format')?.[0]).toEqual(['italic'])
  })

  it('emits format with underline when the underline button is clicked', async () => {
    const wrapper = mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    const btn = findPopover()!.querySelector('button[title^="Underline"]')!
    btn.click()
    expect(wrapper.emitted('format')?.[0]).toEqual(['underline'])
  })

  it('emits format with code when the code button is clicked', async () => {
    const wrapper = mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    const btn = findPopover()!.querySelector('button[title*="code"]')!
    btn.click()
    expect(wrapper.emitted('format')?.[0]).toEqual(['code'])
  })

  it('does not render when disabled', async () => {
    mountBubble({ disabled: true })
    selectRange(target, 0, 5)
    await nextTick()
    expect(findPopover()).toBeNull()
  })

  it('exposes only four format buttons (no link, no lists)', async () => {
    mountBubble({})
    selectRange(target, 0, 5)
    await nextTick()
    const buttons = findPopover()!.querySelectorAll('.md-selection-bubble__btn')
    expect(buttons).toHaveLength(4)
    const titles = Array.from(buttons).map((b) => b.getAttribute('title') ?? '').join(' | ')
    expect(titles).not.toContain('Link')
    expect(titles).not.toContain('list')
    expect(titles).not.toContain('List')
  })
})