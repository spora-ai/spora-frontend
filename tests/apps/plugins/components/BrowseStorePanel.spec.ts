/**
 * BrowseStorePanel — search debounce + catalog grid wiring. The catalog
 * store is fully mocked; assertions stay focused on the panel.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const searchMock = vi.fn()
const packages = ref<unknown[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const query = ref('')
const cachedAt = ref<number | null>(null)
const ttlSeconds = ref(3600)
const clearErrorMock = vi.fn()

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/stores/catalog', () => ({
  useCatalogStore: () => ({
    get packages() { return packages.value },
    get loading() { return loading.value },
    get error() { return error.value },
    get query() { return query.value },
    get cachedAt() { return cachedAt.value },
    get ttlSeconds() { return ttlSeconds.value },
    search: searchMock,
    clearError: clearErrorMock,
  }),
}))

import BrowseStorePanel from '@/apps/plugins/components/BrowseStorePanel.vue'
import { ref } from 'vue'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  packages.value = []
  loading.value = false
  error.value = null
  query.value = ''
  cachedAt.value = null
  ttlSeconds.value = 3600
  searchMock.mockReset().mockResolvedValue(undefined)
  clearErrorMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const baseEntry = {
  name: 'spora-ai/spora-plugin-email',
  description: 'IMAP/SMTP for Spora',
  version: '0.2.1',
  downloads: 0,
  favorites: 0,
  repository: 'https://github.com/spora-ai/spora-plugin-email',
  homepage: null,
}

function mountPanel() {
  return mount(BrowseStorePanel, {
    global: {
      stubs: {
        CatalogCard: { template: '<div class="catalog-card-stub" :data-testid="`catalog-card-${$attrs.entry.name}`" />' },
      },
    },
  })
}

describe('BrowseStorePanel — search input wiring', () => {
  it('renders the search input with id="catalog-search" linked via a <label>', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    const input = wrapper.find('input#catalog-search')
    expect(input.exists()).toBe(true)
    const label = wrapper.find('label[for="catalog-search"]')
    expect(label.exists()).toBe(true)
  })

  it('debounces search() calls by ~300ms on input typing', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    // The panel triggers an initial search on mount — let it flush and reset the spy.
    searchMock.mockClear()

    const input = wrapper.find('input#catalog-search')
    await input.setValue('tav')
    // Only one timer pending; nothing has fired yet.
    expect(searchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(299)
    expect(searchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith('tav')

    // Subsequent keystrokes restart the debounce — old timer must be cleared.
    await input.setValue('tavily')
    await vi.advanceTimersByTimeAsync(300)
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(searchMock).toHaveBeenLastCalledWith('tavily')
  })

  it('triggers an immediate search with "" when the clear button is clicked', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    searchMock.mockClear()

    const input = wrapper.find('input#catalog-search')
    await input.setValue('tavily')
    // Let the debounce settle so the X button shows up.
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(true)

    await wrapper.find('button[aria-label="Clear search"]').trigger('click')
    // No debounce on clear — the call is issued synchronously.
    expect(searchMock).toHaveBeenLastCalledWith('')
    expect(input.element.value).toBe('')
  })

  it('runs the cached query on mount when there are no packages yet', async () => {
    query.value = 'cached-term'
    packages.value = []
    mountPanel()
    await flushPromises()
    expect(searchMock).toHaveBeenCalledWith('cached-term')
  })

  it('skips the initial search on mount when the store already has packages', async () => {
    query.value = 'leftover'
    packages.value = [baseEntry]
    mountPanel()
    await flushPromises()
    expect(searchMock).not.toHaveBeenCalled()
  })
})

describe('BrowseStorePanel — result states', () => {
  it('renders a CatalogCard for each entry in store.packages', async () => {
    packages.value = [baseEntry, { ...baseEntry, name: 'spora-ai/spora-plugin-tavily' }]
    loading.value = false
    const wrapper = mountPanel()
    await flushPromises()
    const cards = wrapper.findAll('.catalog-card-stub')
    expect(cards.length).toBe(2)
  })

  it('shows the loading state when loading and no packages are loaded yet', async () => {
    packages.value = []
    loading.value = true
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('Loading catalog…')
  })

  it('renders the error banner when the store has an error', async () => {
    packages.value = []
    error.value = 'Boom'
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="catalog-error"]').text()).toBe('Boom')
  })

  it('renders the empty-state when no packages and no error and not loading', async () => {
    packages.value = []
    loading.value = false
    error.value = null
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('No plugins found')
    expect(wrapper.text()).toContain('Packagist')
  })

  it('shows a "Cached N min ago" line when cachedAt is set', async () => {
    // Pin Date.now() so the "min ago" number is stable.
    const nowSeconds = 1_700_000_000
    vi.setSystemTime(nowSeconds * 1000)

    packages.value = [baseEntry]
    cachedAt.value = nowSeconds - 12 * 60  // 12 minutes ago
    const wrapper = mountPanel()
    await flushPromises()

    const cached = wrapper.find('[data-testid="catalog-cache-age"]')
    expect(cached.exists()).toBe(true)
    expect(cached.text()).toContain('Cached')
    expect(cached.text()).toContain('12 min ago')
  })

  it('hides the cached-age line when cachedAt is null', async () => {
    packages.value = [baseEntry]
    cachedAt.value = null
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="catalog-cache-age"]').exists()).toBe(false)
  })
})

describe('BrowseStorePanel — installed event', () => {
  it('emits "installed" when a CatalogCard emits "installed"', async () => {
    // Pre-load packages so the panel actually renders the cards.
    packages.value = [baseEntry]
    const wrapper = mount(BrowseStorePanel, {
      global: {
        stubs: {
          // Use a real click-to-emit stub so we can fire `installed`.
          CatalogCard: {
            name: 'CatalogCard',
            template: '<button class="catalog-card-stub" @click="$emit(\'installed\')" />',
          },
        },
      },
    })
    await flushPromises()
    expect(wrapper.find('.catalog-card-stub').exists()).toBe(true)
    await wrapper.find('.catalog-card-stub').trigger('click')
    expect(wrapper.emitted('installed')).toBeTruthy()
    expect(wrapper.emitted('installed')!.length).toBe(1)
  })
})
