import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
import * as VueRouter from 'vue-router'
import * as VueDraggablePlus from 'vue-draggable-plus'
import * as MdEditorV3 from 'md-editor-v3'
import { publishPluginGlobals } from '../../src/utils/publishPluginGlobals'

interface Target {
    Vue?: typeof Vue
    Pinia?: typeof Pinia
    VueRouter?: typeof VueRouter
    VueDraggablePlus?: typeof VueDraggablePlus
    MdEditorV3?: typeof MdEditorV3
}

describe('publishPluginGlobals', () => {
    it('assigns all five plugin globals onto the target window-like object', () => {
        const target: Target = {}
        publishPluginGlobals(Vue, Pinia, target)
        expect(target.Vue).toBe(Vue)
        expect(target.Pinia).toBe(Pinia)
        expect(target.VueRouter).toBe(VueRouter)
        expect(target.VueDraggablePlus).toBe(VueDraggablePlus)
        expect(target.MdEditorV3).toBe(MdEditorV3)
    })

    it('uses the global window by default', () => {
        const w = window as unknown as Target
        const before = {
            Vue: w.Vue,
            Pinia: w.Pinia,
            VueRouter: w.VueRouter,
            VueDraggablePlus: w.VueDraggablePlus,
            MdEditorV3: w.MdEditorV3,
        }
        try {
            publishPluginGlobals(Vue, Pinia)
            expect(w.Vue).toBe(Vue)
            expect(w.Pinia).toBe(Pinia)
            expect(w.VueRouter).toBe(VueRouter)
            expect(w.VueDraggablePlus).toBe(VueDraggablePlus)
            expect(w.MdEditorV3).toBe(MdEditorV3)
        } finally {
            w.Vue = before.Vue
            w.Pinia = before.Pinia
            w.VueRouter = before.VueRouter
            w.VueDraggablePlus = before.VueDraggablePlus
            w.MdEditorV3 = before.MdEditorV3
        }
    })

    it('publishes the same module instances the host uses', () => {
        const target: Target = {}
        publishPluginGlobals(Vue, Pinia, target)
        expect(target.Vue?.createApp).toBe(Vue.createApp)
        expect(target.Pinia?.createPinia).toBe(Pinia.createPinia)
        expect(target.VueRouter?.createRouter).toBe(VueRouter.createRouter)
        expect(target.VueDraggablePlus?.VueDraggable).toBe(VueDraggablePlus.VueDraggable)
        expect(target.MdEditorV3?.MdEditor).toBe(MdEditorV3.MdEditor)
    })
})