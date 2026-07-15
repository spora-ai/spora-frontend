import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
import { publishPluginGlobals } from '../../src/utils/publishPluginGlobals'

describe('publishPluginGlobals', () => {
    it('assigns Vue + Pinia onto the target window-like object', () => {
        const target: { Vue?: typeof Vue; Pinia?: typeof Pinia } = {}
        publishPluginGlobals(Vue, Pinia, target)
        expect(target.Vue).toBe(Vue)
        expect(target.Pinia).toBe(Pinia)
    })

    it('uses the global window by default', () => {
        // The default `target` reads through the runtime `window`. Asserting
        // the assignment shows up there is sufficient because the previous
        // test already proves the assignment logic.
        const before = window.Vue
        try {
            publishPluginGlobals(Vue, Pinia)
            expect(window.Vue).toBe(Vue)
            expect(window.Pinia).toBe(Pinia)
        } finally {
            // Restore so other tests (and any later assignment) see a clean slate.
            ;(window as unknown as { Vue: typeof Vue | undefined }).Vue = before
        }
    })

    it('publishes the same Vue module instance the host uses', () => {
        // Plugins rely on identity equality — if the host publishes a *different*
        // Vue module than the one it actually imported, plugins and the host
        // end up with two reactive systems and `createApp()` from one can't
        // mount components compiled against the other.
        const target: { Vue?: typeof Vue; Pinia?: typeof Pinia } = {}
        publishPluginGlobals(Vue, Pinia, target)
        expect(target.Vue?.createApp).toBe(Vue.createApp)
        expect(target.Pinia?.createPinia).toBe(Pinia.createPinia)
    })
})
