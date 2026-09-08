import { createApp, defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression test for the CSRF token injection bug:
 * `injectCsrfIfNeeded()` resolves `useAuthStore()` via the module-level
 * active Pinia. When a plugin installs its own Pinia (via
 * `app.use(createPinia())`), it displaces the host's Pinia and any
 * subsequent `useAuthStore()` call returns a fresh, uninitialized store
 * with csrfToken=null — so the X-CSRF-Token header is silently omitted
 * and every state-changing request fails with 403 CSRF_TOKEN_MISSING.
 *
 * The fix captures the host's auth store reference at boot time via
 * `setHostAuthStore()`, which injectCsrfIfNeeded() prefers over the
 * dynamic resolution. These tests simulate a plugin mounting with its
 * own Pinia after the host captured the store.
 */
describe('api client — CSRF injection survives plugin Pinia installs', () => {
    beforeEach(() => {
        // Module-level `_hostAuthStore` lives in @/api/client, so reset
        // modules between tests to clear the capture. Each test gets a
        // fresh client + auth store.
        vi.resetModules()
    })
    afterEach(() => {
        setActivePinia(null)
    })

    it('injects X-CSRF-Token from the captured host auth store even after a plugin installs its own Pinia', async () => {
        const { api, setHostAuthStore } = await import('@/api/client')
        const { useAuthStore } = await import('@/stores/auth')

        // 1. Host installs its Pinia and captures the auth store.
        const hostPinia = createPinia()
        setActivePinia(hostPinia)
        const hostAuth = useAuthStore()
        hostAuth.$patch({ csrfToken: 'host-token-abc123', user: { id: 1, email: 'a@b.com', roles: [] } })
        setHostAuthStore(hostAuth)

        // 2. Spy on the underlying fetch — we want to inspect what gets sent.
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
        )

        try {
            // 3. Plugin mounts its own Pinia — this is what was breaking us.
            // `app.use(createPinia())` calls `setActivePinia(this.pinia)`, so
            // any subsequent `useAuthStore()` from `request()` (which runs
            // outside Vue setup/inject context) would return a fresh, empty
            // store on the plugin's Pinia. The captured host store must win.
            const pluginPinia = createPinia()
            const pluginApp = createApp(defineComponent({ render: () => h('div') }))
            pluginApp.use(pluginPinia)

            // 4. POST through the host's api client.
            await api.post('/typst/templates', { name: 'test.typ' })

            // 5. The captured host store's csrfToken must be in the request header.
            expect(fetchSpy).toHaveBeenCalledTimes(1)
            const [, init] = fetchSpy.mock.calls[0]!
            const headers = (init?.headers ?? {}) as Record<string, string>
            expect(headers['X-CSRF-Token']).toBe('host-token-abc123')
        } finally {
            fetchSpy.mockRestore()
        }
    })

    it('still resolves via useAuthStore() fallback when no capture is set', async () => {
        // Sanity check: if setHostAuthStore() was never called, the
        // existing dynamic-resolution path must still work — this keeps
        // unit tests that construct the api client without going through
        // main.ts working.
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
        // Stronger regression: prove the captured store is preferred over
        // the dynamic lookup. After the plugin installs its Pinia, calling
        // `useAuthStore()` directly returns a store with csrfToken=null —
        // but the api client must still inject the captured token.
        const { api, setHostAuthStore } = await import('@/api/client')
        const { useAuthStore } = await import('@/stores/auth')

        const hostPinia = createPinia()
        setActivePinia(hostPinia)
        const hostAuth = useAuthStore()
        hostAuth.$patch({ csrfToken: 'pinned-token', user: { id: 1, email: 'a@b.com', roles: [] } })
        setHostAuthStore(hostAuth)

        // Plugin swaps the active Pinia.
        const pluginPinia = createPinia()
        const pluginApp = createApp(defineComponent({ render: () => h('div') }))
        pluginApp.use(pluginPinia)

        // Sanity check on the simulation: `useAuthStore()` on the plugin
        // Pinia returns a different, empty store — that's the bug we're
        // guarding against.
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