import type * as Vue from 'vue'
import type * as Pinia from 'pinia'

/**
 * Publish Vue + Pinia on a window-like target so plugin IIFE bundles
 * built with `external: ['vue', 'pinia']` can resolve the host's
 * modules at evaluation time. See the plugin author guide for the
 * matching `output.globals` mapping on the consumer side.
 *
 * @param target defaults to the global `window`; tests pass a stub.
 */
export function publishPluginGlobals(
    vueModule: typeof Vue,
    piniaModule: typeof Pinia,
    target: { Vue?: typeof Vue; Pinia?: typeof Pinia } = window as unknown as {
        Vue?: typeof Vue
        Pinia?: typeof Pinia
    },
): void {
    target.Vue = vueModule
    target.Pinia = piniaModule
}
