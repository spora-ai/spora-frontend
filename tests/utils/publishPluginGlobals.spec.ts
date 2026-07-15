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
        const before = window.Vue
        try {
            publishPluginGlobals(Vue, Pinia)
            expect(window.Vue).toBe(Vue)
            expect(window.Pinia).toBe(Pinia)
        } finally {
            ;(window as unknown as { Vue: typeof Vue | undefined }).Vue = before
        }
    })

    it('publishes the same module instance the host uses', () => {
        const target: { Vue?: typeof Vue; Pinia?: typeof Pinia } = {}
        publishPluginGlobals(Vue, Pinia, target)
        expect(target.Vue?.createApp).toBe(Vue.createApp)
        expect(target.Pinia?.createPinia).toBe(Pinia.createPinia)
    })
})
