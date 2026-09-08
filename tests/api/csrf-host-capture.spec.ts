import { createApp, defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: `injectCsrfIfNeeded()` resolves the auth store via the
 * module-level active Pinia, which a plugin's app.use(createPinia())
 * call displaces. The captured-store fix in `src/api/client.ts` +
 * `src/main.ts` makes the X-CSRF-Token header survive that displacement.
 */
describe('api client — CSRF injection survives plugin Pinia installs', () => {
  beforeEach(() => {
    // _hostAuthStore lives in @/api/client — reset modules to clear the capture between tests.
    vi.resetModules()
  })
  afterEach(() => {
    setActivePinia(null)
  })

  it('injects X-CSRF-Token from the captured host auth store even after a plugin installs its own Pinia', async () => {
    const { api, setHostAuthStore } = await import('@/api/client')
    const { useAuthStore } = await import('@/stores/auth')

    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    const hostAuth = useAuthStore()
    hostAuth.$patch({ csrfToken: 'host-token-abc123', user: { id: 1, email: 'a@b.com', roles: [] } })
    setHostAuthStore(hostAuth)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )

    try {
      // Plugin mounts its own Pinia — this is what was breaking us.
      const pluginPinia = createPinia()
      const pluginApp = createApp(defineComponent({ render: () => h('div') }))
      pluginApp.use(pluginPinia)

      await api.post('/typst/templates', { name: 'test.typ' })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]!
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers['X-CSRF-Token']).toBe('host-token-abc123')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('still resolves via useAuthStore() fallback when no capture is set', async () => {
    // Sanity: fallback path keeps tests that skip main.ts working.
    const { api } = await import('@/api/client')
    const { useAuthStore } = await import('@/stores/auth')

    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    const auth = useAuthStore()
    auth.$patch({ csrfToken: 'fallback-token-xyz', user: { id: 1, email: 'a@b.com', roles: [] } })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )

    try {
      await api.post('/typst/templates', { name: 'test.typ' })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]!
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers['X-CSRF-Token']).toBe('fallback-token-xyz')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('capture survives even when useAuthStore() would return a fresh, empty store on the plugin Pinia', async () => {
    const { api, setHostAuthStore } = await import('@/api/client')
    const { useAuthStore } = await import('@/stores/auth')

    const hostPinia = createPinia()
    setActivePinia(hostPinia)
    const hostAuth = useAuthStore()
    hostAuth.$patch({ csrfToken: 'pinned-token', user: { id: 1, email: 'a@b.com', roles: [] } })
    setHostAuthStore(hostAuth)

    const pluginPinia = createPinia()
    const pluginApp = createApp(defineComponent({ render: () => h('div') }))
    pluginApp.use(pluginPinia)

    // Sanity: confirm the simulation actually reproduces the bug —
    // useAuthStore() on the plugin Pinia returns a different, empty store.
    const pluginAuth = useAuthStore()
    expect(pluginAuth).not.toBe(hostAuth)
    expect(pluginAuth.csrfToken).toBeNull()

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )

    try {
      await api.post('/typst/templates', { name: 'test.typ' })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, init] = fetchSpy.mock.calls[0]!
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers['X-CSRF-Token']).toBe('pinned-token')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
