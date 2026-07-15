import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Stub out everything `main.ts` imports besides `vue`, `pinia`, and the
// `publishPluginGlobals` util. Each import triggers a chain of side
// effects in tests (router loads, EventSource opens, CSS parsed, etc.)
// that we don't need to exercise here — the test only cares that
// `publishPluginGlobals` is called as a side effect of evaluating main.ts.
vi.mock('../src/App.vue', () => ({
    default: {
        name: 'App',
        render: () => null,
    },
}))
vi.mock('../src/router', () => ({
    default: {
        install: vi.fn(),
        push: vi.fn(),
        replace: vi.fn(),
        beforeEach: vi.fn(),
    },
}))
vi.mock('../src/style.css', () => ({}))
vi.mock('../src/copyCode', () => ({}))

describe('main.ts bootstrap', () => {
    let originalVue: unknown
    let originalPinia: unknown
    let originalApp: HTMLElement | null

    beforeEach(() => {
        originalVue = (window as { Vue?: unknown }).Vue
        originalPinia = (window as { Pinia?: unknown }).Pinia
        delete (window as { Vue?: unknown }).Vue
        delete (window as { Pinia?: unknown }).Pinia
        // `app.mount('#app')` looks up the element synchronously; provide
        // it before the module's top-level code runs.
        originalApp = document.getElementById('app')
        if (!originalApp) {
            const el = document.createElement('div')
            el.id = 'app'
            document.body.appendChild(el)
        }
    })

    afterEach(() => {
        ;(window as { Vue?: unknown }).Vue = originalVue
        ;(window as { Pinia?: unknown }).Pinia = originalPinia
        if (!originalApp) {
            const el = document.getElementById('app')
            if (el) el.remove()
        }
    })

    it('publishes Vue + Pinia on window when the bundle is evaluated', async () => {
        await import('../src/main')
        expect((window as { Vue?: unknown }).Vue).toBeDefined()
        expect((window as { Pinia?: unknown }).Pinia).toBeDefined()
    })
})
