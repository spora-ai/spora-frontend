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
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
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

beforeEach(() => {
  setActivePinia(createPinia())
  plugins.value = []
  loading.value = false
  error.value = null
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
    const button = wrapper.find('button[type="button"]')
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
