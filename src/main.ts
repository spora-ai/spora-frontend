import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from '@/stores/auth'
import { setHostAuthStore } from '@/api/client'
import { publishPluginGlobals } from './utils/publishPluginGlobals'
import './style.css'
import './copyCode'

// Plugin IIFE bundles evaluate immediately on dynamic-import — globals
// must be on window.* before mount so landing routes like /apps/memories
// don't fail on undefined modules.
publishPluginGlobals(Vue, Pinia)

const app = Vue.createApp(App)

app.use(Pinia.createPinia())
app.use(router)

// Must run AFTER app.use(pinia) (so useAuthStore resolves to the host's
// store) and BEFORE app.mount('#app') (so plugins that install their
// own Pinia in mount() can't displace the captured reference).
setHostAuthStore(useAuthStore() as unknown as Parameters<typeof setHostAuthStore>[0])

app.mount('#app')
