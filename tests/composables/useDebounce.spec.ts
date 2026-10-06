/**
 * useDebounce — ref-based debounce helper for the dashboard search input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, watch, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useDebounce, type UseDebounceReturn } from '@/composables/useDebounce'

interface ExposedHandles {
  handles: UseDebounceReturn<string>
  initial: string
  delayMs: number
}

function mountHarness<T>(initial: T, delayMs: number) {
  let captured: UseDebounceReturn<T> | null = null

  const Harness = defineComponent({
    setup() {
      captured = useDebounce<T>(initial, delayMs)
      return () => h('div')
    },
  })

  const wrapper = mount(Harness)
  if (!captured) {
    throw new Error('useDebounce was not invoked during harness setup')
  }
  const handles = captured as UseDebounceReturn<T>
  return {
    wrapper,
    get value(): Ref<T> {
      return handles.value
    },
    set: handles.set,
    cancel: handles.cancel,
    reset: handles.reset,
  }
}

/**
 * The palette's actual shape: a consumer waiting on a watcher over the
 * debounced ref. Assertions about *whether the watcher fires* need this; the
 * plain harness only exposes the value.
 */
function mountWatchHarness(initial: string, delayMs: number) {
  let captured: UseDebounceReturn<string> | null = null
  const seen: string[] = []

  const Harness = defineComponent({
    setup() {
      captured = useDebounce<string>(initial, delayMs)
      watch(captured.value, (next) => {
        seen.push(next)
      })
      return () => h('div')
    },
  })

  const wrapper = mount(Harness)
  if (!captured) {
    throw new Error('useDebounce was not invoked during harness setup')
  }
  const handles = captured as UseDebounceReturn<string>
  return {
    wrapper,
    seen,
    set: handles.set,
    reset: handles.reset,
  }
}

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value before any set()', () => {
    const { value } = mountHarness('hello', 200)
    expect(value.value).toBe('hello')
  })

  it('updates value after the delay when set() is called once', () => {
    const { value, set } = mountHarness('a', 200)
    set('b')
    expect(value.value).toBe('a')
    vi.advanceTimersByTime(199)
    expect(value.value).toBe('a')
    vi.advanceTimersByTime(1)
    expect(value.value).toBe('b')
  })

  it('coalesces rapid set() calls into the last value', () => {
    const { value, set } = mountHarness('a', 200)
    set('b')
    vi.advanceTimersByTime(100)
    set('c')
    vi.advanceTimersByTime(100)
    set('d')
    vi.advanceTimersByTime(199)
    expect(value.value).toBe('a')
    vi.advanceTimersByTime(1)
    expect(value.value).toBe('d')
  })

  it('cancel() drops the pending update', () => {
    const { value, set, cancel } = mountHarness('a', 200)
    set('b')
    vi.advanceTimersByTime(100)
    cancel()
    vi.advanceTimersByTime(500)
    expect(value.value).toBe('a')
  })

  it('reset() commits immediately and drops the pending update', () => {
    const { value, set, reset } = mountHarness('a', 200)
    set('b')
    reset('c')
    // Committed at once — no debounce delay — and the pending 'b' is gone.
    expect(value.value).toBe('c')
    vi.advanceTimersByTime(500)
    expect(value.value).toBe('c')
  })

  it('reset() moves the value back so re-setting the same value is a change again', async () => {
    // The bug this exists for: Vue skips a watcher when a ref is assigned an
    // equal primitive, so a settled 'inv' re-set to 'inv' fires nothing. The
    // ⌘K palette closes and reopens with the same box, and the second session
    // would never reach the network.
    const { seen, set, reset } = mountWatchHarness('', 200)
    set('inv')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(seen).toEqual(['inv'])

    // Same value again — no watcher, no request. This is the silent no-op.
    set('inv')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(seen).toEqual(['inv'])

    // Routing the value back through reset makes the next set a real change.
    reset('')
    await nextTick()
    expect(seen).toEqual(['inv', ''])

    set('inv')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(seen).toEqual(['inv', '', 'inv'])

    // Documented limit, not an oversight: assigning a ref an equal primitive
    // is a no-op in Vue, so reset() cannot re-fire a watcher for a value that
    // is already current. What it guarantees is that the value is no longer
    // stale, which is what the next identical query depends on.
    reset('')
    await nextTick()
    reset('')
    await nextTick()
    expect(seen).toEqual(['inv', '', 'inv', ''])
  })

  it('reset() cancels the timer without touching an unrelated consumer', () => {
    const first = mountHarness('a', 200)
    first.set('b')
    first.reset('a')
    first.set('b')
    vi.advanceTimersByTime(200)
    expect(first.value.value).toBe('b')

    // `cancel` and `set` keep their old contract for callers that only want
    // the timer dropped: the value stays where it was.
    const second = mountHarness('a', 200)
    second.set('b')
    vi.advanceTimersByTime(200)
    second.cancel()
    expect(second.value.value).toBe('b')
  })

  it('discards pending updates on scope dispose', () => {
    const { value, set, wrapper } = mountHarness('a', 200)
    set('b')
    vi.advanceTimersByTime(100)
    wrapper.unmount()
    vi.advanceTimersByTime(500)
    expect(value.value).toBe('a')
  })

  it('supports non-string types via the generic', () => {
    interface Query {
      page: number
      term: string
    }
    const { value, set } = mountHarness<Query>({ page: 0, term: '' }, 100)
    set({ page: 2, term: 'spora' })
    vi.advanceTimersByTime(100)
    expect(value.value).toEqual({ page: 2, term: 'spora' })
  })

  // Keep the typed wrapper happy when no test reads the exposed harness shape.
  const _exposed: ExposedHandles | null = null
  void _exposed
})