import { createApp } from 'vue'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import { publishPluginGlobals } from './utils/publishPluginGlobals'
import './style.css'
import './copyCode'

const app = createApp(App)

app.use(Pinia.createPinia())
app.use(router)

app.mount('#app')

publishPluginGlobals(Vue, Pinia)
