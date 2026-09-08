import type * as Vue from 'vue'
import type * as Pinia from 'pinia'
import * as VueRouter from 'vue-router'
import * as VueDraggablePlus from 'vue-draggable-plus'
import * as MdEditorV3 from 'md-editor-v3'

/**
 * Exposes host modules to plugin IIFE bundles built with these as
 * `output.globals` externals. Each global must be the namespace object
 * (`window.VueRouter.createRouter`, `window.VueDraggablePlus.VueDraggable`,
 * `window.MdEditorV3.MdEditor`) — Rollup rewrites plugin imports to
 * `<global>.<namedExport>(...)` under `output.globals`.
 *
 * Vue + Pinia are injected (not imported here) because main.ts already
 * holds the live module references and tests assert reference equality.
 * The other three are imported so the host always publishes its own
 * copies — sharing is what lets plugin frontends piggy-back on the
 * host's router, draggable component, and Markdown editor without
 * re-bundling them.
 *
 * @param target defaults to `window`; tests pass a stub.
 */
export function publishPluginGlobals(
    vueModule: typeof Vue,
    piniaModule: typeof Pinia,
    target: PluginGlobals = window as unknown as PluginGlobals,
): void {
    target.Vue = vueModule
    target.Pinia = piniaModule
    target.VueRouter = VueRouter
    target.VueDraggablePlus = VueDraggablePlus
    target.MdEditorV3 = MdEditorV3
}

interface PluginGlobals {
    Vue?: typeof Vue
    Pinia?: typeof Pinia
    VueRouter?: typeof VueRouter
    VueDraggablePlus?: typeof VueDraggablePlus
    MdEditorV3?: typeof MdEditorV3
}
