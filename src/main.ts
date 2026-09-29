import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/auth'
import { setHostAuthStore } from '@/api/client'
import { publishPluginGlobals } from './utils/publishPluginGlobals'
// Style import order is the CSS cascade layer order (Vite concatenates
// the bundle in import order, and the first `@layer` statement fixes the
// layer ranking). `./style.css` owns Tailwind's `theme` / `base` /
// `utilities` blocks, so the package's `@layer components` has to come
// after it — otherwise `components` outranks Tailwind's `base` preflight.
// `./copyCode` stays last: it is unlayered, so ordering only matters for
// readability.
import './style.css'
import '@spora-ai/components/styles'
import './copyCode'

// Plugin IIFE bundles evaluate immediately on dynamic-import — globals
// must be on window.* before mount so landing routes like /apps/memories
// don't fail on undefined modules.
publishPluginGlobals(Vue, Pinia)

const app = Vue.createApp(App)

app.use(Pinia.createPinia())
app.use(router)

// After app.use(pinia) so useAuthStore resolves, before app.mount() so
// plugins that install their own Pinia in mount() can't displace the
// captured reference.
setHostAuthStore(useAuthStore())

app.mount('#app')
