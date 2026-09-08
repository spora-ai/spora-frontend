import type * as Vue from 'vue'
import type * as Pinia from 'pinia'
import * as VueRouter from 'vue-router'
import * as VueDraggablePlus from 'vue-draggable-plus'
import * as MdEditorV3 from 'md-editor-v3'

/**
 * Publish Vue, Pinia, vue-router, vue-draggable-plus, and md-editor-v3 on
 * a window-like target so plugin IIFE bundles built with these as
 * `output.globals` externals can resolve the host's modules at evaluation
 * time. See the plugin author guide for the matching `output.globals`
 * mapping on the consumer side.
 *
 * Each global is the namespace object (e.g. `window.VueRouter.createRouter`,
 * `window.VueDraggablePlus.VueDraggable`, `window.MdEditorV3.MdEditor`),
 * NOT a default export or wrapper — plugin bundles destructure the named
 * exports they import via `import { ... } from 'package'`, which Rollup
 * rewrites to `<global>.<namedExport>(...)` under `output.globals`.
 *
 * Vue + Pinia are passed in (rather than imported here) because the host
 * bootstrap in `main.ts` already holds the live module references and
 * tests assert reference equality against those instances. The other
 * three are imported here so the host always publishes its own copies —
 * sharing is what lets plugin frontends piggy-back on the host's router,
 * draggable component, and Markdown editor without re-bundling them.
 *
 * @param target defaults to the global `window`; tests pass a stub.
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
