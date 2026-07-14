import { createApp } from 'vue'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import './copyCode'

const app = createApp(App)

app.use(Pinia.createPinia())
app.use(router)

app.mount('#app')

// Publish the host's Vue + Pinia modules on `window` so plugin IIFE
// bundles built with `external: ['vue', 'pinia']` can resolve them at
// evaluation time. Without this, the Rollup-emitted call site
// `})(window.Vue, window.Pinia);` (see the matching `output.globals`
// block in `spora-plugin-*/vite.config.ts`) reads `undefined` and the
// plugin throws `Vue is not defined` on mount.
//
// Plugins don't share the host's Pinia state — they instantiate a
// local one inside their `mount()` (see `spora-plugin-media-archive-
// frontend/src/main.ts`). They only need `Vue.createApp` and
// `Pinia.createPinia` as constructor functions. Publishing the
// namespace keeps the host and every plugin pointing at the same
// underlying Vue module instance, which is what the plugin's
// vite.config.ts comment calls out as the reason for the externals.
;(window as unknown as { Vue: typeof Vue }).Vue = Vue
;(window as unknown as { Pinia: typeof Pinia }).Pinia = Pinia
