/**
 * useDebounce — ref-based debounce helper for the dashboard search input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, type Ref } from 'vue'
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