import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import { publishPluginGlobals } from './utils/publishPluginGlobals'
import './style.css'
import './copyCode'

// Publish before mount so any plugin IIFE bundle loaded during the initial
// route resolution (e.g. when `/apps/memories` is the landing route) can
// resolve `window.Vue` / `window.VueRouter` / etc. — `publishPluginGlobals`
// only writes `window.*` references; the host's `app.mount()` is what
// eventually triggers `mountPlugin` via `PluginAppPage.vue#onMounted`.
publishPluginGlobals(Vue, Pinia)

const app = Vue.createApp(App)

app.use(Pinia.createPinia())
app.use(router)

app.mount('#app')
