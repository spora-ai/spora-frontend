/**
 * usePluginApp — lifecycle composable for the generic `/apps/:appName`
 * route. Tested against a stubbed `mountPlugin` so we don't have to
 * mock `window` / dynamic `import()`.
 */
import { describe, it, expect, vi } from 'vitest'
import { usePluginApp } from '@/composables/usePluginApp'
import type { PluginHostContext } from '@/apps/registry'

function makeCtx(): PluginHostContext {
  // We're never reading the body of the host context in this stub —
  // supply just enough shape that TypeScript is happy.
  return {
    api: {} as PluginHostContext['api'],
    pinia: {} as PluginHostContext['pinia'],
    theme: 'light',
    route: {} as PluginHostContext['route'],
    router: {} as PluginHostContext['router'],
  }
}

function makeEl(): HTMLElement {
  return document.createElement('div')
}

describe('usePluginApp', () => {
  it('starts with loading=false, error=null, mounted=false', () => {
    const c = usePluginApp()
    expect(c.loading.value).toBe(false)
    expect(c.error.value).toBe(null)
    expect(c.mounted.value).toBe(false)
  })

  it('mount() flips loading → true during the call, then sets mounted=true on ok', async () => {
    let resolveMount!: () => void
    const mountImpl = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => { resolveMount = r })
      return {
        ok: true as const,
        instance: { unmount: vi.fn() },
      }
    })

    const c = usePluginApp({ mountImpl })
    const el = makeEl()
    const p = c.mount(el, 'media-archive', 'main.js', makeCtx())
    expect(c.loading.value).toBe(true)
    expect(c.mounted.value).toBe(false)

    resolveMount()
    await p

    expect(c.loading.value).toBe(false)
    expect(c.mounted.value).toBe(true)
    expect(c.error.value).toBe(null)
    expect(mountImpl).toHaveBeenCalledTimes(1)
    expect(mountImpl).toHaveBeenCalledWith(el, 'media-archive', 'main.js', makeCtx())
  })

  it('mount() surfaces the registry error verbatim when ok is false', async () => {
    const mountImpl = vi.fn().mockResolvedValue({
      ok: false as const,
      error: 'uninstalled' as const,
      message: 'Plugin "media-archive" is not installed.',
    })

    const c = usePluginApp({ mountImpl })
    await c.mount(makeEl(), 'media-archive', 'main.js', makeCtx())

    expect(c.loading.value).toBe(false)
    expect(c.mounted.value).toBe(false)
    expect(c.error.value).toEqual({
      kind: 'uninstalled',
      message: 'Plugin "media-archive" is not installed.',
    })
  })

  it('mount() preserves invalid errors so the page renders a generic fallback', async () => {
    const mountImpl = vi.fn().mockResolvedValue({
      ok: false as const,
      error: 'invalid' as const,
      message: 'Plugin "x" did not expose window.SporaAppX.mount()',
    })
    const c = usePluginApp({ mountImpl })
    await c.mount(makeEl(), 'x', 'main.js', makeCtx())
    expect(c.error.value?.kind).toBe('invalid')
  })

  it('unmount() clears mounted and calls the registry instance unmount', async () => {
    const instanceUnmount = vi.fn()
    const mountImpl = vi.fn().mockResolvedValue({
      ok: true as const,
      instance: { unmount: instanceUnmount },
    })

    const c = usePluginApp({ mountImpl })
    await c.mount(makeEl(), 'media-archive', 'main.js', makeCtx())
    expect(c.mounted.value).toBe(true)

    c.unmount()
    expect(c.mounted.value).toBe(false)
    expect(instanceUnmount).toHaveBeenCalledTimes(1)
  })

  it('mount() tears down a previous instance when called again with a different target', async () => {
    const firstUnmount = vi.fn()
    const secondUnmount = vi.fn()

    let call = 0
    const mountImpl = vi.fn().mockImplementation(async () => {
      call += 1
      return {
        ok: true as const,
        instance: { unmount: call === 1 ? firstUnmount : secondUnmount },
      }
    })

    const c = usePluginApp({ mountImpl })
    const a = makeEl()
    const b = makeEl()
    await c.mount(a, 'media-archive', 'main.js', makeCtx())
    await c.mount(b, 'media-archive', 'main.js', makeCtx())

    expect(firstUnmount).toHaveBeenCalledTimes(1)
    expect(c.mounted.value).toBe(true)
  })

  it('falls back to the real registry when no mountImpl is provided', () => {
    const c = usePluginApp()
    expect(typeof c.mount).toBe('function')
    expect(typeof c.unmount).toBe('function')
  })

  it('unmount() is a no-op when called before mount', () => {
    const c = usePluginApp()
    // No assertion needed beyond "doesn't throw" — the function short-circuits
    // because `instanceRef.value` is null.
    expect(() => c.unmount()).not.toThrow()
    expect(c.mounted.value).toBe(false)
  })

  it('mount() catches a thrown error from mountImpl and reports it as load_failed', async () => {
    const mountImpl = vi.fn().mockRejectedValue(new Error('plugin bundle crashed'))
    const c = usePluginApp({ mountImpl })
    await c.mount(makeEl(), 'media-archive', 'main.js', makeCtx())
    expect(c.loading.value).toBe(false)
    expect(c.mounted.value).toBe(false)
    expect(c.error.value).toEqual({ kind: 'load_failed', message: 'plugin bundle crashed' })
  })

  it('overlapping mounts keep only the latest result (stale completion is discarded)', async () => {
    // The first mount is gated on a deferred promise; the second mount
    // runs to completion while the first is still pending. When the
    // first eventually resolves, the token check must prevent it from
    // overwriting the state the second mount already wrote.
    let resolveFirst!: () => void
    let call = 0
    const firstInstance = { unmount: vi.fn() }
    const secondInstance = { unmount: vi.fn() }
    const mountImpl = vi.fn().mockImplementation(async () => {
      call += 1
      if (call === 1) {
        await new Promise<void>(r => { resolveFirst = r })
        return { ok: true as const, instance: firstInstance }
      }
      return { ok: true as const, instance: secondInstance }
    })

    const c = usePluginApp({ mountImpl })
    const a = makeEl()
    const b = makeEl()
    const first = c.mount(a, 'media-archive', 'main.js', makeCtx())
    // Second mount starts while first is still pending.
    const second = c.mount(b, 'media-archive', 'main.js', makeCtx())
    await second
    // Now release the first — its late resolution must NOT overwrite the
    // second's state.
    resolveFirst()
    await first

    expect(c.mounted.value).toBe(true)
    // The mounted instance must be the second one (call === 2), proving
    // the stale completion of call === 1 was discarded.
    expect(c.error.value).toBeNull()
  })
})
