/**
 * useDebounce — ref-based debounce helper used by the dashboard search input
 * and the ⌘K palette's server query.
 *
 * Wraps a reactive `value` so that rapid `set(...)` calls only commit the most
 * recent value after `delayMs` of inactivity. A pending update can be dropped
 * with `cancel()`, or dropped and the value moved immediately with `reset()`,
 * and the pending timer is cleared automatically when the calling effect scope
 * is disposed (component unmount) so we never commit a stale value into an
 * unmounted component.
 */

import { ref, onScopeDispose, type Ref } from 'vue'

export interface UseDebounceReturn<T> {
  /** Reactive current value. Starts at `initial`, updates only after the debounce delay. */
  value: Ref<T>
  /**
   * Schedule `value` to become `next` after `delayMs` of inactivity.
   * Each call resets the pending timer so only the last call wins.
   */
  set: (next: T) => void
  /** Drop the pending update without changing `value`. */
  cancel: () => void
  /**
   * Drop the pending update AND commit `next` immediately.
   *
   * `cancel()` alone cannot reset a debounced value: Vue skips a watcher when
   * a ref is assigned an equal primitive, so re-setting the value already on
   * screen fires nothing and a caller waiting on that watcher (the ⌘K
   * palette re-issuing the previous session's query) never runs again.
   * Routing the value back through `reset` makes the next `set(next)` a real
   * change again.
   */
  reset: (next: T) => void
}

/**
 * Create a debounced ref. `set(next)` updates `value` after `delayMs` of
 * inactivity (each call resets the timer); `cancel()` clears the pending
 * timer; `reset(next)` clears the timer and commits `next` synchronously.
 * Any pending update is also discarded when the calling effect scope
 * is disposed, which prevents late commits from writing into a torn-down
 * component.
 *
 * @param initial  Initial value for the ref.
 * @param delayMs  Debounce window in milliseconds. Calls closer than this
 *                 apart collapse into a single update.
 */
export function useDebounce<T>(initial: T, delayMs: number): UseDebounceReturn<T> {
  const value = ref(initial) as Ref<T>
  let timerId: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  const set = (next: T): void => {
    clearTimer()
    timerId = setTimeout(() => {
      timerId = null
      value.value = next
    }, delayMs)
  }

  const cancel = (): void => {
    clearTimer()
  }

  const reset = (next: T): void => {
    clearTimer()
    value.value = next
  }

  // Component unmount safety: drop any pending update instead of writing into
  // a disposed effect scope.
  onScopeDispose(() => {
    clearTimer()
  })

  return { value, set, cancel, reset }
}