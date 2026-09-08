import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
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

app.mount('#app')
