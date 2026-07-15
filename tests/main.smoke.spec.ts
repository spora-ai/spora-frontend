import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Stub the heavy imports `main.ts` pulls in so the side-effect test
// can evaluate the bootstrap without booting the router, opening an
// EventSource, etc.
vi.mock('../src/App.vue', () => ({
    default: { name: 'App', render: () => null },
}))
vi.mock('../src/router', () => ({
    default: { install: vi.fn(), push: vi.fn(), replace: vi.fn(), beforeEach: vi.fn() },
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
