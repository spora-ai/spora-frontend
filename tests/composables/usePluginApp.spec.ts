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
})
