import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { i18n } from '@/i18n'
import { setHostAuthStore } from '@/api/client'
import { publishPluginGlobals } from './utils/publishPluginGlobals'
// Import order is the cascade layer order: `./style.css` must come first so
// the package's `@layer components` ranks below Tailwind's `base`.
import './style.css'
import '@spora-ai/components/styles'
import './copyCode'

// Plugin IIFE bundles evaluate immediately on dynamic-import — globals
// must be on window.* before mount so landing routes like /apps/memories
// don't fail on undefined modules.
publishPluginGlobals(Vue, Pinia)

const app = Vue.createApp(App)

app.use(Pinia.createPinia())
app.use(i18n)
app.use(router)

// After app.use(pinia) so useAuthStore resolves, before app.mount() so
// plugins that install their own Pinia in mount() can't displace the
// captured reference.
setHostAuthStore(useAuthStore())

// Resolving the locale is not awaited: the app boots in the locale cached
// from the previous visit, and init() swaps in the authoritative answer
// (user preference → instance default) once it arrives. Awaiting it would
// put a session round trip on the critical path of the first paint to
// avoid a flash that the cache already prevents.
void useLocaleStore().init()

app.mount('#app')
