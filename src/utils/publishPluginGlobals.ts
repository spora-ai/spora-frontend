import type * as Vue from 'vue'
import type * as Pinia from 'pinia'

/**
 * Publish the host's Vue + Pinia modules on `window` so plugin IIFE
 * bundles built with `external: ['vue', 'pinia']` can resolve them at
 * evaluation time. Without this, the Rollup-emitted call site
 * `})(window.Vue, window.Pinia);` (see the matching `output.globals`
 * block in each plugin's `vite.config.ts`) reads `undefined` and the
 * plugin throws `Vue is not defined` on mount.
 *
 * Plugins don't share the host's Pinia state — they instantiate a
 * local one inside their `mount()` (see
 * `spora-plugin-media-archive-frontend/src/main.ts`). They only need
 * `Vue.createApp` and `Pinia.createPinia` as constructor functions.
 * Publishing the namespace keeps the host and every plugin pointing
 * at the same underlying Vue module instance, which is what the
 * plugin's `vite.config.ts` comment calls out as the reason for the
 * externals.
 *
 * Extracted from `main.ts` so the assignment is unit-testable —
 * module-load side effects can't be covered by v8 if `main.ts` is
 * never imported in tests (which it isn't — the SPA's tests import
 * individual components/stores, not the bootstrap).
 *
 * @param vueModule   the host's `vue` namespace (e.g. `import * as Vue from 'vue'`)
 * @param piniaModule the host's `pinia` namespace (e.g. `import * as Pinia from 'pinia'`)
 * @param target      the window-like object to publish onto; defaults to the
 *                    global `window`. Tests pass a plain object.
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
