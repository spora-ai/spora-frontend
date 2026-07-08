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

const PluginInstallModalStub = defineComponent({
  name: 'InstallPluginModal',
  props: ['open', 'package'],
  emits: ['close', 'installed'],
  setup(props, { emit }) {
    return () => props.open
      ? h('div', { 'data-testid': 'install-plugin-modal' }, [
          h('span', { 'data-testid': 'install-modal-package' }, String(props.package ?? '')),
          h('button', { 'data-testid': 'install-modal-close', onClick: () => emit('close') }, 'close'),
          h('button', { 'data-testid': 'install-modal-installed', onClick: () => emit('installed', { package: 'spora-ai/spora-plugin-tavily' }) }, 'installed'),
        ])
      : null
  },
})

const DialogStub = defineComponent({
  name: 'PluginDetailDialog',
  props: ['open', 'plugin'],
  emits: ['close', 'installed'],
  setup(props, { emit, slots }) {
    return () => props.open
      ? h('div', { 'data-testid': 'plugin-detail-dialog' }, [
          h('button', { class: 'dialog-stub', onClick: () => emit('close') }, slots.default?.()),
          h('button', { class: 'dialog-emit-installed', onClick: () => emit('installed', { package: 'spora-ai/spora-plugin-tavily' }) }, 'installed'),
        ])
      : null
  },
})

const stubs = {
  GlobalNavbar: { template: '<div class="navbar-stub" />' },
  PluginCard: { template: '<div class="card-stub" @click="$emit(\'select\', $attrs.plugin)" />', inheritAttrs: false },
  PluginDetailDialog: DialogStub,
  InstallPluginModal: PluginInstallModalStub,
  RefreshCw: { template: '<span class="refresh-stub" />' },
  Puzzle: { template: '<span class="puzzle-stub" />' },
  AlertTriangle: { template: '<span class="alert-stub" />' },
  BrowseStorePanel: {
    template: '<div class="browse-stub"><button class="emit-install" @click="$emit(\'install\', \'spora-ai/spora-plugin-tavily\')" /></div>',
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
    expect(wrapper.find('[data-testid="plugin-detail-dialog"]').exists()).toBe(true)
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
    expect(wrapper.find('[data-testid="plugin-detail-dialog"]').exists()).toBe(true)

    await wrapper.find('.dialog-stub').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="plugin-detail-dialog"]').exists()).toBe(false)
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

describe('PluginsPage — non-admin visibility', () => {
  it('shows the admin-only note and hides the Install button for a non-admin even when plugin_install_enabled is true', async () => {
    authUser.value = { id: 1, is_admin: false }
    await primeRuntimeConfig({ pluginInstallEnabled: true })

    const wrapper = await mountPage()
    const note = wrapper.find('[data-testid="plugins-admin-only-note"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('restricted to administrators')
    // No install affordances for non-admins.
    expect(wrapper.find('[data-testid="install-plugin-button"]').exists()).toBe(false)
    // No disabled-state banner for non-admins — the rule is "you're not
    // an admin", not "the feature is off".
    expect(wrapper.find('[data-testid="plugin-install-disabled-banner"]').exists()).toBe(false)
  })

  it('shows the admin-only note for a non-admin even when plugin_install_enabled is false', async () => {
    authUser.value = { id: 1, is_admin: false }
    await primeRuntimeConfig({ pluginInstallEnabled: false })

    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="plugins-admin-only-note"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plugin-install-disabled-banner"]').exists()).toBe(false)
  })

  it('hides the admin-only note for an admin regardless of the plugin_install_enabled flag', async () => {
    authUser.value = { id: 1, is_admin: true }

    // Flag on: no note, no banner.
    await primeRuntimeConfig({ pluginInstallEnabled: true })
    let wrapper = await mountPage()
    expect(wrapper.find('[data-testid="plugins-admin-only-note"]').exists()).toBe(false)

    // Flag off: no note, but the disabled banner IS shown to admins.
    await primeRuntimeConfig({ pluginInstallEnabled: false })
    wrapper = await mountPage()
    expect(wrapper.find('[data-testid="plugins-admin-only-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plugin-install-disabled-banner"]').exists()).toBe(true)
  })
})

describe('PluginsPage — Browse tab + install handoff', () => {
  beforeEach(async () => {
    // The header Install button is gated on `showInstallButton`
    // (admin + `pluginInstallEnabled`); prime both for these flows.
    await primeRuntimeConfig({ pluginInstallEnabled: true })
  })

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

  it('opens the install modal pre-filled and flips to Installed when BrowseStorePanel emits "install"', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="tab-browse"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.browse-stub').exists()).toBe(true)

    await wrapper.find('.emit-install').trigger('click')
    await nextTick()

    // Tab flipped to Installed; modal is now open with the prefilled package.
    expect(wrapper.find('.browse-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="install-plugin-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="install-modal-package"]').text()).toBe('spora-ai/spora-plugin-tavily')
  })

  it('calls store.load() when the page-level install modal emits "installed"', async () => {
    const wrapper = await mountPage()
    expect(loadMock).toHaveBeenCalledTimes(1) // mount

    // Open the modal via the page header button.
    await wrapper.find('[data-testid="install-plugin-button"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="install-plugin-modal"]').exists()).toBe(true)

    // Stub fires `@installed` — page should call store.load().
    await wrapper.find('[data-testid="install-modal-installed"]').trigger('click')
    await flushPromises()

    expect(loadMock).toHaveBeenCalledTimes(2)
  })

  it('swallows errors from the post-install load() call', async () => {
    loadMock.mockRejectedValueOnce(new Error('server down'))
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="install-plugin-button"]').trigger('click')
    await nextTick()

    await expect(wrapper.find('[data-testid="install-modal-installed"]').trigger('click')).resolves.not.toThrow()
    await flushPromises()
  })

  it('resets installPackage when the modal is closed, so a subsequent header-button open shows an empty input', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="tab-browse"]').trigger('click')
    await nextTick()

    // Trigger the Browse → install handoff with package X.
    await wrapper.find('.emit-install').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="install-modal-package"]').text()).toBe('spora-ai/spora-plugin-tavily')

    // Close the modal.
    await wrapper.find('[data-testid="install-modal-close"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="install-plugin-modal"]').exists()).toBe(false)

    // Re-open via the header button — package slot must be empty.
    await wrapper.find('[data-testid="install-plugin-button"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="install-plugin-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="install-modal-package"]').text()).toBe('')
  })
})

describe('PluginsPage — PluginDetailDialog installed handoff', () => {
  beforeEach(async () => {
    await primeRuntimeConfig({ pluginInstallEnabled: true })
  })

  it('calls store.load() when PluginDetailDialog emits "installed"', async () => {
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
    expect(loadMock).toHaveBeenCalledTimes(1)

    await wrapper.find('.card-stub').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="plugin-detail-dialog"]').exists()).toBe(true)

    await wrapper.find('.dialog-emit-installed').trigger('click')
    await flushPromises()

    expect(loadMock).toHaveBeenCalledTimes(2)
  })
})
