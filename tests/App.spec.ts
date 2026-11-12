/**
 * The root `<RouterView :key>` decides when a route gets a fresh instance:
 * a param change must remount, a query-only change must not (layouts render
 * inside it, so remounting restarts their data layer).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const setupSessionHandlerMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  setupSessionHandler: setupSessionHandlerMock,
}))

const toastErrorMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ toasts: [], dismiss: vi.fn(), error: toastErrorMock }),
}))

const logoutMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ logout: logoutMock }),
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

/**
 * The session-expiry redirect has to clear the session before it navigates:
 * `login` is a guest-only route, and the guard bounces a still-authenticated
 * visitor back to the dashboard. Pushing first landed the operator on the
 * dashboard instead of the login page.
 */
describe('App session expiry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupSessionHandlerMock.mockClear()
    toastErrorMock.mockClear()
    logoutMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the session before navigating to login', async () => {
    const order: string[] = []
    let settleLogout: () => void = () => {}
    logoutMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          order.push('logout')
          settleLogout = () => {
            order.push('logged out')
            resolve()
          }
        }),
    )

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'dashboard', component: countingPage },
        { path: '/login', name: 'login', component: countingPage },
      ],
    })
    await router.push('/')
    await router.isReady()

    mount(App, {
      global: {
        plugins: [router, setActivePinia(createPinia())],
        stubs: { ToastContainer: true },
      },
    })
    await flushPromises()

    router.afterEach(() => {
      order.push('navigate')
    })

    setupSessionHandlerMock.mock.calls[0][0]()
    vi.advanceTimersByTime(3000)
    await flushPromises()

    // The navigation must not have happened yet — the session is still being
    // cleared, and `login` would bounce a still-authenticated visitor back.
    expect(order).toEqual(['logout'])
    expect(router.currentRoute.value.name).toBe('dashboard')

    settleLogout()
    await flushPromises()

    expect(order).toEqual(['logout', 'logged out', 'navigate'])
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('logs out and goes to the login page when the toast action is taken', async () => {
    const order: string[] = []
    logoutMock.mockImplementation(async () => {
      order.push('logout')
    })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'dashboard', component: countingPage },
        { path: '/login', name: 'login', component: countingPage },
      ],
    })
    await router.push('/')
    await router.isReady()

    mount(App, {
      global: {
        plugins: [router, setActivePinia(createPinia())],
        stubs: { ToastContainer: true },
      },
    })
    await flushPromises()

    router.afterEach(() => {
      order.push('navigate')
    })

    setupSessionHandlerMock.mock.calls[0][0]()
    await flushPromises()

    // The toast offers the operator the same way out.
    const toastOptions = toastErrorMock.mock.calls[0][1] as {
      action: string
      onAction: () => void
    }
    expect(toastOptions.action).toBe('Login now')

    toastOptions.onAction()
    await flushPromises()

    // The session has to be cleared before the navigation: `login` is a
    // guest-only route, and the guard bounces a still-authenticated visitor
    // back to the dashboard.
    expect(order).toEqual(['logout', 'navigate'])
    expect(router.currentRoute.value.name).toBe('login')
  })
})
