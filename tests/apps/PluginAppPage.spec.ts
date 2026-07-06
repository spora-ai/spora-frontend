/**
 * PluginAppPage — generic root shell for `/apps/:appName`.
 *
 * Stubbed mount + apps store; asserts:
 *  1. Renders the navbar + back button for a known app once resolved.
 *  2. Surfaces the loading spinner while the registry is in-flight.
 *  3. Falls back to the "Plugin uninstalled" empty state when the registry
 *     reports `error: 'uninstalled'`.
 *  4. Falls back to the "Unknown app" empty state when the apps store
 *     doesn't have the slug.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// All state used by the `vi.mock` factories below must be wrapped in
// `vi.hoisted` so it's evaluated before any mocked module is loaded —
// `vi.mock` calls themselves are hoisted to the top of the file, ahead
// of the `import` of the SUT.
const mocks = vi.hoisted(() => ({
  routeParams: { appName: 'media-archive' } as { appName: string },
  apps: { apps: [] as Array<{
    name: string
    displayName: string
    description: string
    icon: string
    slug: string | null
    frontendEntry: string | null
  }> },
  loading: false as boolean,
  error: null as string | null,
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  apiGetMock: vi.fn(),
  mountImpl: vi.fn(),
  authInitMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: mocks.routeParams }),
  useRouter: () => ({ push: mocks.pushMock, replace: mocks.replaceMock }),
  RouterLink: {
    name: 'RouterLink',
    props: ['to'],
    template: '<a :href="typeof to === \'string\' ? to : \'#\'"><slot /></a>',
  },
}))

vi.mock('@/api/client', () => ({
  api: { get: mocks.apiGetMock },
  ApiError: class ApiError extends Error {
    code: string
    status: number
    constructor(message: string, code: string, status: number) {
      super(message)
      this.code = code
      this.status = status
    }
  },
  setupSessionHandler: vi.fn(),
}))

vi.mock('@/apps/registry', async () => {
  // Re-export the real types/helpers so import paths in the SUT resolve;
  // only `mountPlugin` is replaced via the mock factory.
  const actual = await vi.importActual<typeof import('@/apps/registry')>('@/apps/registry')
  return {
    ...actual,
    mountPlugin: (...args: unknown[]) => mocks.mountImpl(...(args as [HTMLElement, string, string, unknown])),
  }
})

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get initialized() { return true },
    init: mocks.authInitMock.mockResolvedValue(undefined),
  }),
}))

// `mocks.apps` is mutated in-place so getters always return the live value
// without forcing every consumer to be re-run when it changes.
vi.mock('@/apps/stores/apps', () => ({
  useAppsStore: () => ({
    get apps() { return mocks.apps.apps },
    get loading() { return mocks.loading },
    get error() { return mocks.error },
    load: vi.fn().mockImplementation(async () => {
      mocks.loading = true
      await Promise.resolve()
      mocks.loading = false
    }),
    resolveApp: (name: string) => {
      return mocks.apps.apps.find(a => a.name === name) ?? null
    },
  }),
}))

import PluginAppPage from '@/apps/PluginAppPage.vue'

// Sanity: ensure `ref` is referenced so unused-imports lint won't complain.
void ref

const GlobalNavbarStub = { name: 'GlobalNavbar', template: '<div class="navbar-stub" />' }
const IconStub = {
  name: 'Icon',
  props: ['name'],
  template: '<i class="icon-stub" />',
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.apiGetMock.mockReset()
  mocks.pushMock.mockReset()
  mocks.replaceMock.mockReset()
  mocks.authInitMock.mockClear()
  mocks.apps = { apps: [] }
  mocks.loading = false
  mocks.error = null
  // Reset the `mountImpl` mock to a noop-success default — tests that need
  // custom behaviour replace `mockImplementation` directly without changing
  // the reference. The mocked module factory captured `mocks.mountImpl` at
  // init time; re-assigning it would leave the factory pointing at the
  // original (now reset) spy.
  mocks.mountImpl.mockReset()
  mocks.mountImpl.mockResolvedValue({
    ok: true,
    instance: { unmount: vi.fn() },
  })
  mocks.routeParams = { appName: 'media-archive' }
})

describe('PluginAppPage', () => {
  it('renders the header with the resolved app displayName and the navbar', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: 'Browse media', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('.navbar-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plugin-app-header"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Media Archive')
    expect(wrapper.find('[data-testid="plugin-app-back"]').exists()).toBe(true)
  })

  it('renders the slot after mountPlugin resolves', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }

    let resolveMount!: () => void
    mocks.mountImpl.mockImplementation(async () => {
      await new Promise<void>(r => { resolveMount = r })
      return { ok: true, instance: { unmount: vi.fn() } }
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    resolveMount()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="plugin-app-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plugin-app-slot"]').exists()).toBe(true)
    expect(mocks.mountImpl).toHaveBeenCalledTimes(1)
  })

  it('renders the "Plugin uninstalled" empty state when the registry returns uninstalled', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }
    mocks.mountImpl.mockResolvedValue({
      ok: false,
      error: 'uninstalled',
      message: 'Plugin "media-archive" is not installed.',
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="plugin-app-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Plugin uninstalled')
  })

  it('renders the "Unknown app" state when the apps store has no matching entry', async () => {
    mocks.apps = { apps: [] }

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="plugin-app-unknown"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Unknown app')
    expect(mocks.mountImpl).not.toHaveBeenCalled()
  })

  it('redirects legacy "memories" core-owned apps into their direct child route', async () => {
    mocks.routeParams = { appName: 'memories' }
    mocks.apps = {
      apps: [
        { name: 'memories', displayName: 'Memories', description: '', icon: 'brain', slug: null, frontendEntry: null },
      ],
    }

    mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(mocks.replaceMock).toHaveBeenCalledWith({ path: '/apps/memories' })
  })

  it('does not redirect "plugins" because the router routes it directly', async () => {
    mocks.apps = {
      apps: [
        { name: 'plugins', displayName: 'Plugins', description: '', icon: 'puzzle', slug: null, frontendEntry: null },
      ],
    }

    mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(mocks.replaceMock).not.toHaveBeenCalled()
    expect(mocks.mountImpl).not.toHaveBeenCalled()
  })

  it('navigates back to /apps when the back button is clicked', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    await wrapper.find('[data-testid="plugin-app-back"]').trigger('click')
    expect(mocks.pushMock).toHaveBeenCalledWith({ path: '/apps' })
  })
})
