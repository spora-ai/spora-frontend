/**
 * useChatAutoScroll — keeps the transcript on the newest message until the
 * operator scrolls up to read something.
 *
 * The scroll surface is a real element with a real scroll position, so the
 * spec drives it the way the browser does: set the position and fire the
 * event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'
import { useChatAutoScroll } from '@/composables/useChatAutoScroll'

const SCROLL_HEIGHT = 1000
const CLIENT_HEIGHT = 400
const MAX_SCROLL_TOP = SCROLL_HEIGHT - CLIENT_HEIGHT

/**
 * happy-dom does not compute styles, so the surface states its overflow on
 * the element and the stub reads it back.
 */
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', (el: Element) => ({
    overflowY: el.getAttribute('data-overflow-y') ?? '',
  }) as CSSStyleDeclaration)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * A scroll surface with a transcript inside it. The surface is the element
 * the transcript scrolls in — in the app that is the layout's scroll
 * container, not the transcript's own box.
 */
function makeSurface() {
  let scrollHeight = SCROLL_HEIGHT
  const surface = document.createElement('div')
  surface.setAttribute('data-overflow-y', 'auto')
  Object.defineProperty(surface, 'scrollHeight', { get: () => scrollHeight, configurable: true })
  Object.defineProperty(surface, 'clientHeight', { value: CLIENT_HEIGHT, configurable: true })
  surface.scrollTop = 0

  const transcript = document.createElement('div')
  surface.appendChild(transcript)

  return {
    surface,
    transcript,
    /** The surface grew or shrank — content above or below the transcript. */
    setHeight(height: number): void {
      scrollHeight = height
    },
  }
}

/** Move the surface and tell the chat about it, the way the browser does. */
function scrollTo(surface: HTMLElement, top: number): void {
  surface.scrollTop = top
  surface.dispatchEvent(new Event('scroll'))
}

function setup(transcript: HTMLElement) {
  const scrollToBottom = vi.fn()
  const scope = effectScope()
  const composable = scope.run(() =>
    useChatAutoScroll({ transcript: ref(transcript) as Ref<HTMLElement | null>, scrollToBottom }),
  )!
  // The chat follows the newest message when it opens — that is also what
  // attaches the scroll listener the operator's scrolling is read from.
  composable.follow()
  scrollToBottom.mockClear()
  return { ...composable, scrollToBottom, scope }
}

describe('useChatAutoScroll', () => {
  it('follows the newest message while the operator has not scrolled away', () => {
    const { transcript } = makeSurface()
    const { follow, scrollToBottom, scope } = setup(transcript)

    follow()

    expect(scrollToBottom).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('pauses when the operator scrolls up', () => {
    const { surface, transcript } = makeSurface()
    const { paused, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    scrollTo(surface, MAX_SCROLL_TOP - 300)

    expect(paused.value).toBe(true)
    scope.stop()
  })

  it('does not pull the transcript down while the operator reads above it', () => {
    const { surface, transcript } = makeSurface()
    const { paused, follow, scrollToBottom, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    scrollTo(surface, MAX_SCROLL_TOP - 300)
    follow()

    expect(paused.value).toBe(true)
    expect(scrollToBottom).not.toHaveBeenCalled()
    scope.stop()
  })

  it('follows again when the operator scrolls back to the newest message', () => {
    const { surface, transcript } = makeSurface()
    const { paused, follow, scrollToBottom, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    scrollTo(surface, MAX_SCROLL_TOP - 300)
    scrollTo(surface, MAX_SCROLL_TOP)
    follow()

    expect(paused.value).toBe(false)
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('keeps following while the chat scrolls to the newest message itself', () => {
    const { surface, transcript, setHeight } = makeSurface()
    const { paused, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    // A message arrives below the transcript and the chat scrolls down to
    // it — every position it passes through is above the bottom.
    setHeight(SCROLL_HEIGHT + 200)
    scrollTo(surface, MAX_SCROLL_TOP + 100)

    expect(paused.value).toBe(false)
    scope.stop()
  })

  it('does not read the browser scroll anchoring as the operator scrolling away', () => {
    const { surface, transcript, setHeight } = makeSurface()
    const { paused, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    // Content inserted above the transcript pushes the position down.
    setHeight(SCROLL_HEIGHT + 120)
    scrollTo(surface, MAX_SCROLL_TOP + 120)

    expect(paused.value).toBe(false)
    scope.stop()
  })

  it('does not pause when the content above the transcript shrinks', () => {
    const { surface, transcript, setHeight } = makeSurface()
    const { paused, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    // A panel above the transcript closes: the surface gets shorter and
    // the browser keeps the view where it was.
    setHeight(SCROLL_HEIGHT - 200)
    scrollTo(surface, MAX_SCROLL_TOP - 200)

    expect(paused.value).toBe(false)
    scope.stop()
  })

  it('brings the newest message back when the operator asks for it', () => {
    const { surface, transcript } = makeSurface()
    const { paused, resume, scrollToBottom, scope } = setup(transcript)

    scrollTo(surface, MAX_SCROLL_TOP)
    scrollTo(surface, MAX_SCROLL_TOP - 300)
    resume()

    expect(paused.value).toBe(false)
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('stops listening once the scope is disposed', () => {
    const { surface, transcript } = makeSurface()
    const { paused, scope } = setup(transcript)

    scope.stop()
    scrollTo(surface, MAX_SCROLL_TOP - 300)

    expect(paused.value).toBe(false)
  })
})
