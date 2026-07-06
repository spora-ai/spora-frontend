/**
 * PluginsPage — root page for the /apps/plugins route. Heavy children
 * (GlobalNavbar, dialog, BrowseStorePanel) are stubbed so assertions
 * stay focused on the page's wiring.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick, defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

const plugins = ref<unknown[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const loadMock = vi.fn()

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

const authUser = ref<{ id: number; is_admin: boolean } | null>({ id: 1, is_admin: true })
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return authUser.value },
  }),
}))

vi.mock('@/apps/plugins/stores/plugins', () => ({
  usePluginsStore: () => ({
    get plugins() { return plugins.value },
    get loading() { return loading.value },
    get error() { return error.value },
    load: loadMock,
  }),
}))

import PluginsPage from '@/apps/plugins/pages/PluginsPage.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { api } from '@/api/client'

const mockApiGet = api.get as ReturnType<typeof vi.fn>

/** Force the runtime config store into a known state for assertions. */
async function primeRuntimeConfig(overrides: { pluginInstallEnabled: boolean; pluginCatalogEnabled?: boolean }): Promise<void> {
  const store = useRuntimeConfigStore()
  // Direct mutation — `init()` dedupes via initPromise, so re-calling it
  // would return the cached result from the first call. Set the refs
  // directly for predictable per-test state.
  store.allowRegistration = true
  store.pluginInstallEnabled = overrides.pluginInstallEnabled
  store.pluginCatalogEnabled = overrides.pluginCatalogEnabled ?? true
  store.initialized = true
  store.initError = null
}

beforeEach(() => {
  setActivePinia(createPinia())
  plugins.value = []
  loading.value = false
  error.value = null
  authUser.value = { id: 1, is_admin: true }
  loadMock.mockReset().mockResolvedValue(undefined)
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

// Mirrors the v-if="open" binding so close restores the DOM the same
// way the real Dialog does.
const DialogStub = defineComponent({
  name: 'PluginDetailDialog',
  props: ['open', 'plugin'],
  emits: ['close'],
  setup(props, { emit, slots }) {
    return () => props.open
      ? h('button', { class: 'dialog-stub', onClick: () => emit('close') }, slots.default?.())
      : null
  },
})

const stubs = {
  GlobalNavbar: { template: '<div class="navbar-stub" />' },
  PluginCard: { template: '<div class="card-stub" @click="$emit(\'select\', $attrs.plugin)" />', inheritAttrs: false },
  PluginDetailDialog: DialogStub,
  RefreshCw: { template: '<span class="refresh-stub" />' },
  Puzzle: { template: '<span class="puzzle-stub" />' },
  AlertTriangle: { template: '<span class="alert-stub" />' },
  BrowseStorePanel: {
    template: '<div class="browse-stub"><button class="emit-installed" @click="$emit(\'installed\')" /></div>',
  },
}

async function mountPage() {
  const wrapper = mount(PluginsPage, {
    global: { plugins: [makeRouter()], stubs },
  })
  await flushPromises()
  return wrapper
}

describe('PluginsPage', () => {
  beforeEach(async () => {
    // Default: plugin install enabled, so the existing assertions that
    // look for the Install button / Update actions keep working.
    await primeRuntimeConfig({ pluginInstallEnabled: true })
  })

  it('calls store.load() on mount', async () => {
    await mountPage()
    expect(loadMock).toHaveBeenCalledTimes(1)
  })

  it('renders the page header', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Plugins')
    expect(wrapper.text()).toContain('Installed plugins')
  })

  it('renders the empty-state when no plugins are installed', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('No plugins installed')
  })

  it('renders the loading message when loading and no plugins', async () => {
    loading.value = true
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Loading…')
  })

  it('renders the error banner when the store has an error', async () => {
    error.value = 'Boom'
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Boom')
  })

  it('reloads when the refresh button is clicked', async () => {
    const wrapper = await mountPage()
    expect(loadMock).toHaveBeenCalledTimes(1)
    // Use the data-testid so we don't accidentally match the tab buttons
    // or — when the install feature is on — the Install button.
    const button = wrapper.find('[data-testid="refresh-plugins-button"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(loadMock).toHaveBeenCalledTimes(2)
  })

  it('opens the detail dialog when a PluginCard emits select', async () => {
    plugins.value = [
      {
        slug: 'minimax',
        name: 'MiniMax',
        description: '',
        icon: 'puzzle',
        version: 1,
        path: '/p',
        bundledTools: [],
        bundledDrivers: [],
        recipePaths: [],
        migrations: { declared: 1, applied: 1, filesOnDisk: 1, pending: 0, lastAppliedAt: null, status: 'up_to_date' },
      },
    ]
    const wrapper = await mountPage()
    const card = wrapper.find('.card-stub')
    expect(card.exists()).toBe(true)
    await card.trigger('click')
    await nextTick()
    expect(wrapper.find('.dialog-stub').exists()).toBe(true)
  })

  it('closes the detail dialog when it emits "close"', async () => {
    plugins.value = [
      {
        slug: 'minimax',
        name: 'MiniMax',
        description: '',
        icon: 'puzzle',
        version: 1,
        path: '/p',
        bundledTools: [],
        bundledDrivers: [],
        recipePaths: [],
        migrations: { declared: 1, applied: 1, filesOnDisk: 1, pending: 0, lastAppliedAt: null, status: 'up_to_date' },
      },
    ]
    const wrapper = await mountPage()
    await wrapper.find('.card-stub').trigger('click')
    await nextTick()
    expect(wrapper.find('.dialog-stub').exists()).toBe(true)

    await wrapper.find('.dialog-stub').trigger('click')
    await nextTick()
    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })

  it('shows the disabled-state banner and hides the Install button when plugin_install_enabled is false', async () => {
    await primeRuntimeConfig({ pluginInstallEnabled: false })
    const wrapper = await mountPage()
    const banner = wrapper.find('[data-testid="plugin-install-disabled-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Plugin install, uninstall, and update via the Web UI are disabled')
    expect(wrapper.find('[data-testid="install-plugin-button"]').exists()).toBe(false)
  })

  it('shows the Install button and no banner when plugin_install_enabled is true', async () => {
    await primeRuntimeConfig({ pluginInstallEnabled: true })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="plugin-install-disabled-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="install-plugin-button"]').exists()).toBe(true)
  })
})

describe('PluginsPage — Browse tab + onCatalogInstalled', () => {
  it('renders the Browse tab when the user toggles to it', async () => {
    const wrapper = await mountPage()
    const browseTab = wrapper.find('[data-testid="tab-browse"]')
    expect(browseTab.exists()).toBe(true)
    await browseTab.trigger('click')
    await nextTick()
    expect(wrapper.find('.browse-stub').exists()).toBe(true)
  })

  it('switches back to the Installed tab when the Installed tab is clicked', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="tab-browse"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.browse-stub').exists()).toBe(true)

    await wrapper.find('[data-testid="tab-installed"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.browse-stub').exists()).toBe(false)
  })

  it('refreshes the inventory and flips back to Installed when BrowseStorePanel emits "installed"', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="tab-browse"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.browse-stub').exists()).toBe(true)

    const callsBefore = loadMock.mock.calls.length

    await wrapper.find('.emit-installed').trigger('click')
    await flushPromises()

    expect(loadMock.mock.calls.length).toBe(callsBefore + 1)
    expect(wrapper.find('.browse-stub').exists()).toBe(false)
  })

  it('swallows errors from the post-install load() call', async () => {
    loadMock.mockRejectedValueOnce(new Error('server down'))
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="tab-browse"]').trigger('click')
    await nextTick()

    await expect(wrapper.find('.emit-installed').trigger('click')).resolves.not.toThrow()
    await flushPromises()
  })
})
