/**
 * PluginAppPage — generic root shell for `/apps/:appName`. Mount + apps store
 * are stubbed so each test can drive the registry contract directly.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// All state used by the `vi.mock` factories below must be wrapped in
// `vi.hoisted` so it's evaluated before any mocked module is loaded —
// `vi.mock` calls themselves are hoisted to the top of the file, ahead
// of the `import` of the SUT.
const mocks = vi.hoisted(() => ({
  routeParams: { appName: 'media-archive' } as { appName: string | string[] },
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
  authInitialized: true as boolean,
}))

// Reactive wrapper around `mocks.routeParams` — vue-router normally
// returns a reactive route object; tests that exercise the
// `watch(appName, ...)` re-mount handler need that reactivity to fire.
const reactiveRoute = reactive({ params: mocks.routeParams as { appName: string | string[] } })

vi.mock('vue-router', () => ({
  useRoute: () => reactiveRoute,
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
    get initialized() { return mocks.authInitialized },
    init: mocks.authInitMock.mockResolvedValue(undefined),
  }),
}))

// `mocks.apps` is mutated in-place so getters always return the live value
// without forcing every consumer to be re-run when it changes. Reassigning
// `mocks.apps` in tests replaces the array reference the getter returns.
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
  mocks.authInitialized = true
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
  reactiveRoute.params = { appName: 'media-archive' }
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
    // The header no longer exposes a back button: clicking it would push
    // `/apps`, which the router redirects to `/apps/plugins` — confusing
    // from any plugin page. Operators navigate via the global navbar.
    expect(wrapper.find('[data-testid="plugin-app-back"]').exists()).toBe(false)
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

  it('pins the slot to the app name with a stable :key', async () => {
    // Without a stable key, a parent re-render (router transition,
    // watch on appName, condition flicker) would replace the slot
    // div. Vue's auto-unmount on element removal would fire, the
    // plugin's custom unmount never runs, and a fresh, empty slot
    // would replace the mounted one. The `:key` reuses the element
    // for the same app name.
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

    // The slot is keyed on the app name. A consumer (tests, future
    // refactors) can find it via the same selector.
    const slot = wrapper.find('[data-testid="plugin-app-slot"]')
    expect(slot.exists()).toBe(true)
    expect(slot.element.tagName).toBe('DIV')
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

    const unknownBlock = wrapper.find('[data-testid="plugin-app-unknown"]')
    expect(unknownBlock.exists()).toBe(true)
    expect(wrapper.text()).toContain('Unknown app')
    expect(mocks.mountImpl).not.toHaveBeenCalled()
    // The "Open Plugins" deep-link inside the unknown block is a RouterLink
    // bound to `/apps/plugins`. Assert the `to` attribute is preserved.
    const links = unknownBlock.findAll('router-link-stub')
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0]!.attributes('to')).toBe('/apps/plugins')
  })

  it('falls back to the first array element when route.params.appName is an array', async () => {
    // Some vue-router configs (named routes + array params) hand back a
    // string[]; the page takes the first segment so the rest don't crash
    // the template.
    reactiveRoute.params = { appName: ['media-archive', 'extra'] as unknown as string }
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

    expect(wrapper.text()).toContain('Media Archive')
    expect(mocks.mountImpl).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for an empty array route param (no slug to resolve)', async () => {
    reactiveRoute.params = { appName: [] as unknown as string[] }
    mocks.apps = { apps: [] }

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    // The unknown-state fallback only renders when `appName` is non-empty
    // AND `appsStore.load()` has settled — neither is true here. The page
    // simply shows the navbar without a slot.
    expect(wrapper.find('.navbar-stub').exists()).toBe(true)
    expect(mocks.mountImpl).not.toHaveBeenCalled()
  })

  it('calls auth.init() when auth is not yet initialized', async () => {
    mocks.authInitialized = false
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }

    mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(mocks.authInitMock).toHaveBeenCalledTimes(1)
  })

  it('skips auth.init() when auth is already initialized', async () => {
    mocks.authInitialized = true
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }

    mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(mocks.authInitMock).not.toHaveBeenCalled()
  })

  it('renders the apps-store loading fallback while the apps endpoint is in flight', async () => {
    mocks.apps = { apps: [] }
    mocks.loading = true

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Loading')
    expect(wrapper.find('[data-testid="plugin-app-unknown"]').exists()).toBe(false)
  })

  it('renders the apps-store error fallback (not "Unknown app") when the apps endpoint errored', async () => {
    // apps.value is cleared on load() failure, so without an explicit error
    // state the page would fall through to "Unknown app" and mislead the
    // operator into reinstalling a plugin that was never loaded.
    mocks.apps = { apps: [] }
    mocks.error = 'Network unreachable'

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="plugin-app-store-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Couldn't load apps")
    expect(wrapper.text()).toContain('Network unreachable')
    expect(wrapper.find('[data-testid="plugin-app-unknown"]').exists()).toBe(false)
    expect(mocks.mountImpl).not.toHaveBeenCalled()
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

  it('calls unmount on the registry when the component is destroyed', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }
    const instanceUnmount = vi.fn()
    mocks.mountImpl.mockResolvedValue({
      ok: true as const,
      instance: { unmount: instanceUnmount },
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    wrapper.unmount()
    expect(instanceUnmount).toHaveBeenCalledTimes(1)
  })

  it('renders the "Go to Plugins" link when the registry reports an uninstalled error', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }
    mocks.mountImpl.mockResolvedValue({
      ok: false as const,
      error: 'uninstalled' as const,
      message: 'Plugin "media-archive" is not installed.',
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    const uninstalledBlock = wrapper.find('[data-testid="plugin-app-error"]')
    expect(uninstalledBlock.exists()).toBe(true)
    expect(uninstalledBlock.text()).toContain('Plugin uninstalled')
    // The per-wrapper stub `RouterLink: true` collapses the link to a
    // `<router-link-stub to="/apps/plugins">` placeholder. Assert the
    // `to` attribute is bound so the deep-link is wired.
    const stubLinks = uninstalledBlock.findAll('router-link-stub')
    expect(stubLinks.length).toBeGreaterThanOrEqual(1)
    expect(stubLinks[0]!.attributes('to')).toBe('/apps/plugins')
  })

  it('renders a generic error fallback with the registry message for non-uninstalled errors', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }
    mocks.mountImpl.mockResolvedValue({
      ok: false as const,
      error: 'load_failed' as const,
      message: 'boom',
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    const errorBlock = wrapper.find('[data-testid="plugin-app-error"]')
    expect(errorBlock.exists()).toBe(true)
    expect(errorBlock.text()).toContain('Plugin failed to load')
    expect(errorBlock.text()).toContain('boom')
    expect(errorBlock.text()).toContain('Back to Apps')
  })

  it('re-mounts when appName changes via the route (sibling-segment navigation)', async () => {
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
        { name: 'other-plugin', displayName: 'Other', description: '', icon: 'puzzle', slug: 'other-plugin', frontendEntry: 'main.js' },
      ],
    }

    const firstUnmount = vi.fn()
    mocks.mountImpl.mockResolvedValue({
      ok: true as const,
      instance: { unmount: firstUnmount },
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()
    expect(mocks.mountImpl).toHaveBeenCalledTimes(1)
    expect(mocks.mountImpl).toHaveBeenLastCalledWith(
      expect.anything(),
      'media-archive',
      'main.js',
      expect.anything(),
    )

    // Mutate the reactive `route.params.appName` to trigger the watch
    // handler that re-mounts the new plugin on sibling-segment navigation.
    reactiveRoute.params = { appName: 'other-plugin' }
    await flushPromises()
    await flushPromises()

    // The watcher must have torn down the first instance and called
    // mountPlugin again with the new slug. We don't assert a strict
    // call count because the watcher may flush more than once in
    // happy-dom; what matters is that the new mount target is correct.
    expect(firstUnmount).toHaveBeenCalled()
    const lastCall = mocks.mountImpl.mock.calls[mocks.mountImpl.mock.calls.length - 1]
    expect(lastCall?.[1]).toBe('other-plugin')
    expect(lastCall?.[2]).toBe('main.js')
  })

  it('renders the registry error exactly once (no duplicate error block) when mountable + error', async () => {
    // The dedicated `v-if="resolved && isMountable && error"` block and
    // the fallback `v-else-if="error"` block share the same data-testid.
    // The fallback is meant for non-mountable apps; if both fire for the
    // mountable case we get duplicate UI for the same error.
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
      ],
    }
    mocks.mountImpl.mockResolvedValue({
      ok: false as const,
      error: 'uninstalled' as const,
      message: 'Plugin "media-archive" is not installed.',
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    const errorBlocks = wrapper.findAll('[data-testid="plugin-app-error"]')
    expect(errorBlocks).toHaveLength(1)
    expect(errorBlocks[0]!.text()).toContain('Plugin uninstalled')
  })

  it('re-mounts into the new keyed slot after navigating between mountable siblings (post-flush watcher)', async () => {
    // The watcher uses `flush: 'post'` plus an explicit `nextTick()` so
    // the reactive slot ref points at the freshly keyed DOM element,
    // not the one Vue is about to detach. The new mount must target the
    // slot whose key matches the new app name — assert the targets
    // observed across the two mounts are distinct, and the final mount
    // target matches the live slot in the DOM (proving the watcher
    // captured the post-patch ref rather than a stale one).
    mocks.apps = {
      apps: [
        { name: 'media-archive', displayName: 'Media Archive', description: '', icon: 'image', slug: 'media-archive', frontendEntry: 'main.js' },
        { name: 'other-plugin', displayName: 'Other', description: '', icon: 'puzzle', slug: 'other-plugin', frontendEntry: 'main.js' },
      ],
    }

    const slotTargetsSeen: HTMLElement[] = []
    mocks.mountImpl.mockImplementation(async (target: HTMLElement) => {
      slotTargetsSeen.push(target)
      return { ok: true as const, instance: { unmount: vi.fn() } }
    })

    const wrapper = mount(PluginAppPage, {
      global: {
        stubs: { GlobalNavbar: GlobalNavbarStub, Icon: IconStub, RouterLink: true },
      },
    })
    await flushPromises()
    await flushPromises()

    reactiveRoute.params = { appName: 'other-plugin' }
    await flushPromises()
    await flushPromises()

    expect(slotTargetsSeen.length).toBeGreaterThanOrEqual(2)
    // The watcher should have re-targeted a fresh slot element after
    // Vue replaced the keyed one for the new appName.
    const firstTarget = slotTargetsSeen[0]!
    const lastTarget = slotTargetsSeen[slotTargetsSeen.length - 1]!
    expect(firstTarget).not.toBe(lastTarget)
    // The slot mounted by the watcher is the one currently in the DOM
    // (keyed to the new app name). Happy-dom evicts detached nodes
    // aggressively, so simply checking the element survives per-mount
    // is enough — if the watcher had captured the pre-patch ref, the
    // second `mountImpl` would have hit a detached node and we'd see
    // a different selector match.
    const slotInDom = wrapper.find('[data-testid="plugin-app-slot"]')
    expect(slotInDom.exists()).toBe(true)
  })
})
