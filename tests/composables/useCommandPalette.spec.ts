/**
 * useCommandPalette — singleton global state for the ⌘K palette.
 *
 * Covers the public state surface (toggle/open/close idempotency), the
 * ⌘K / Ctrl+K / Escape hotkey wiring, the onMounted/onBeforeUnmount
 * listener lifecycle, and the module-level singleton guarantee that
 * lets two callers in two components share the same `isOpen` ref.
 *
 * The composable caches `isOpen` (and the listener function) at module
 * scope — vi.resetModules() runs in beforeEach so each test gets a
 * fresh module instance, otherwise a previous test's listener would
 * still be attached to window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

function dispatchKey(opts: { key: string; metaKey?: boolean; ctrlKey?: boolean }): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: opts.key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  }))
}

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toggle() flips isOpen', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const { isOpen, toggle } = useCommandPalette()
    expect(isOpen.value).toBe(false)
    toggle()
    expect(isOpen.value).toBe(true)
    toggle()
    expect(isOpen.value).toBe(false)
  })

  it('open() then close() is idempotent', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const { isOpen, open, close } = useCommandPalette()
    open()
    expect(isOpen.value).toBe(true)
    open()
    expect(isOpen.value).toBe(true)
    close()
    expect(isOpen.value).toBe(false)
    close()
    expect(isOpen.value).toBe(false)
  })

  it('dispatching a synthetic Cmd+K event on window toggles isOpen (post-mount)', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const Harness = defineComponent({
      setup() {
        const palette = useCommandPalette()
        return { palette }
      },
      render() {
        return h('div')
      },
    })
    const wrapper = mount(Harness)
    expect(wrapper.vm.palette.isOpen.value).toBe(false)

    dispatchKey({ key: 'k', metaKey: true })
    expect(wrapper.vm.palette.isOpen.value).toBe(true)

    dispatchKey({ key: 'k', metaKey: true })
    expect(wrapper.vm.palette.isOpen.value).toBe(false)

    // Ctrl+K is the non-Mac alias and must behave the same.
    dispatchKey({ key: 'k', ctrlKey: true })
    expect(wrapper.vm.palette.isOpen.value).toBe(true)

    wrapper.unmount()
  })

  it('Escape closes the palette when open (post-mount)', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const Harness = defineComponent({
      setup() {
        const palette = useCommandPalette()
        return { palette }
      },
      render() {
        return h('div')
      },
    })
    const wrapper = mount(Harness)
    wrapper.vm.palette.open()
    expect(wrapper.vm.palette.isOpen.value).toBe(true)

    dispatchKey({ key: 'Escape' })
    expect(wrapper.vm.palette.isOpen.value).toBe(false)

    // Escape with palette already closed is a no-op (handler short-
    // circuits on `isOpen.value`).
    dispatchKey({ key: 'Escape' })
    expect(wrapper.vm.palette.isOpen.value).toBe(false)

    wrapper.unmount()
  })

  it('removes the keydown listener on unmount so further events do not toggle', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const Harness = defineComponent({
      setup() {
        const palette = useCommandPalette()
        return { palette }
      },
      render() {
        return h('div')
      },
    })
    const wrapper = mount(Harness)
    dispatchKey({ key: 'k', metaKey: true })
    expect(wrapper.vm.palette.isOpen.value).toBe(true)

    wrapper.unmount()

    // After unmount, the listener is gone — a fresh Cmd+K must not
    // flip the singleton state.
    dispatchKey({ key: 'k', metaKey: true })
    expect(wrapper.vm.palette.isOpen.value).toBe(true)
  })

  it('multiple callers share state via the module-level singleton', async () => {
    const { useCommandPalette } = await import('@/composables/useCommandPalette')
    const { isOpen: aOpen, open } = useCommandPalette()
    const { isOpen: bOpen, toggle } = useCommandPalette()
    const { isOpen: cOpen, close } = useCommandPalette()

    expect(aOpen).toBe(bOpen)
    expect(bOpen).toBe(cOpen)

    open()
    expect(aOpen.value).toBe(true)
    expect(bOpen.value).toBe(true)
    expect(cOpen.value).toBe(true)

    toggle()
    expect(aOpen.value).toBe(false)
    expect(bOpen.value).toBe(false)

    close()
    expect(cOpen.value).toBe(false)
  })
})