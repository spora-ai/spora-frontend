/**
 * The root `<RouterView :key>` decides when a route gets a fresh instance:
 * a param change must remount, a query-only change must not (layouts render
 * inside it, so remounting restarts their data layer).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const setupSessionHandlerMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  setupSessionHandler: setupSessionHandlerMock,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ toasts: [], dismiss: vi.fn(), error: vi.fn() }),
}))

import App from '@/App.vue'

let mounts = 0

/** Counts mounts so a spec can tell reuse from a remount. */
const countingPage = defineComponent({
  name: 'CountingPage',
  setup() {
    mounts += 1
    return () => h('div', { class: 'counting-page' }, `mount #${mounts}`)
  },
})

async function mountApp(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/agents/:id', name: 'agent', component: countingPage },
      { path: '/settings/tools', name: 'settings-tools', component: countingPage },
    ],
  })
  await router.push(initialPath)
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, {
    global: {
      plugins: [router, pinia],
      stubs: { ToastContainer: true },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('App root RouterView key', () => {
  beforeEach(() => {
    mounts = 0
    setActivePinia(createPinia())
  })

  it('remounts the page when a route param changes', async () => {
    const { wrapper, router } = await mountApp('/agents/8')
    expect(mounts).toBe(1)

    await router.push('/agents/42')
    await flushPromises()

    expect(wrapper.findAll('.counting-page')).toHaveLength(1)
    expect(mounts).toBe(2)
  })

  it('reuses the page instance when only the query changes', async () => {
    const { wrapper, router } = await mountApp('/settings/tools')
    expect(mounts).toBe(1)

    await router.push({ name: 'settings-tools', query: { tool: 'media' } })
    await flushPromises()

    expect(wrapper.findAll('.counting-page')).toHaveLength(1)
    expect(mounts).toBe(1)
  })
})
