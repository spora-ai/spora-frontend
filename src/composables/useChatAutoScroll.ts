import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * How far from the bottom still counts as "at the bottom", in pixels.
 *
 * A scroll that ends a few pixels short of the bottom — a wheel gesture
 * that ran out, or a fractional device pixel ratio — would otherwise
 * leave the chat paused while the operator is looking at the newest
 * message.
 */
const BOTTOM_TOLERANCE_PX = 24

export interface ChatAutoScrollOptions {
  /** The transcript. The surface it scrolls in is one of its ancestors. */
  transcript: Ref<HTMLElement | null>
  /** Brings the transcript's newest message into view. */
  scrollToBottom: () => void
}

export interface ChatAutoScroll {
  /** True while the operator reads above the newest message. */
  paused: Ref<boolean>
  /** Brings the newest message into view, unless the operator is reading. */
  follow: () => void
  /** Follows the newest message again, whatever the operator's position. */
  resume: () => void
}

/**
 * Keeps the transcript on the newest message while the chat runs, and
 * lets the operator read above it.
 */
export function useChatAutoScroll(options: ChatAutoScrollOptions): ChatAutoScroll {
  const paused = ref(false)
  let surface: HTMLElement | null = null
  let lastScrollTop = 0

  /**
   * The element the transcript scrolls in.
   *
   * The chat column is not height-constrained, so the transcript does not
   * scroll in a box of its own: the surface is an ancestor of it, and it
   * only scrolls once the transcript is taller than the viewport.
   */
  function findSurface(): HTMLElement | null {
    let node: HTMLElement | null = options.transcript.value
    while (node) {
      const overflowY = getComputedStyle(node).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node
      }
      node = node.parentElement
    }
    return null
  }

  function onScroll(): void {
    if (!surface) return
    const position = surface.scrollTop
    const distance = surface.scrollHeight - position - surface.clientHeight
    const movedDown = position > lastScrollTop
    lastScrollTop = position

    if (distance <= BOTTOM_TOLERANCE_PX) {
      // The newest message is in view.
      paused.value = false
      return
    }

    if (movedDown) {
      // The position is on its way down: the chat is scrolling itself, or
      // the operator is scrolling back towards the newest message. Neither
      // is the operator reading above it.
      return
    }

    // The operator scrolled up: the newest message is out of view and the
    // position is not on its way back down to it.
    paused.value = true
  }

  /**
   * Point the listener at the surface the transcript scrolls in.
   *
   * The surface only exists once the transcript is taller than the
   * viewport, so it is looked for again whenever the chat follows.
   */
  function sync(): void {
    const next = findSurface()
    if (next === surface) return
    surface?.removeEventListener('scroll', onScroll)
    surface = next
    lastScrollTop = surface?.scrollTop ?? 0
    surface?.addEventListener('scroll', onScroll)
  }

  function follow(): void {
    sync()
    if (paused.value) return
    options.scrollToBottom()
  }

  function resume(): void {
    paused.value = false
    sync()
    options.scrollToBottom()
  }

  onScopeDispose(() => {
    surface?.removeEventListener('scroll', onScroll)
    surface = null
  })

  return { paused, follow, resume }
}
