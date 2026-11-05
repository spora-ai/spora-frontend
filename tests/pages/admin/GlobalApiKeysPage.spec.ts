/**
 * GlobalApiKeysPage — the install-wide keys.
 *
 * A global key reaches every group, their agents and their chats: the widest
 * credential Spora issues. The page is therefore admin-only, and it says
 * plainly what such a key reaches — including what it does not.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/stores/auth', () => ({ useAuthStore: vi.fn() }))

vi.mock('@/api/apiKeys', () => ({
  apiKeysApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn() }),
}))

const { useAuthStore } = await import('@/stores/auth')
const { apiKeysApi } = await import('@/api/apiKeys')

import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const setAuthUser = (is_admin: boolean) => {
  vi.mocked(useAuthStore).mockReturnValue({
    user: {
      id: 1,
      email: is_admin ? 'admin@x.com' : 'user@x.com',
      username: 'u',
      name: is_admin ? 'Admin' : 'User',
      roles: [is_admin ? 'ADMIN' : 'USER'],
      is_admin,
      verified: true,
    },
  } as unknown as ReturnType<typeof useAuthStore>)
}

import GlobalApiKeysPage from '@/pages/admin/GlobalApiKeysPage.vue'

const ApiKeysSectionStub = {
  name: 'ApiKeysSection',
  props: ['scope', 'targetId', 'heading', 'settingLabel'],
  template: '<div class="api-keys-section-stub" />',
}

const globalKey = {
  id: 'g1',
  scope: 'global' as const,
  agent_id: null,
  group_id: null,
  name: 'install-wide',
  last_used_at: null,
  created_at: '2026-10-01T08:00:00Z',
}

function render() {
  return mount(GlobalApiKeysPage, {
    global: {
      stubs: {
        Icon: true,
        ApiKeysSection: ApiKeysSectionStub,
      },
    },
  })
}

/** The real section, so the scope's toggle has something to act on. */
function renderWithTheSection() {
  return mount(GlobalApiKeysPage, {
    global: {
      stubs: {
        Icon: true,
        ApiKeyCreateModal: true,
        ApiKeyRevealModal: true,
      },
    },
  })
}

describe('GlobalApiKeysPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows the keys section to an admin', () => {
    setAuthUser(true)
    const wrapper = render()

    expect(wrapper.find('.api-keys-section-stub').exists()).toBe(true)
  })

  it('tells a non-admin nothing', () => {
    setAuthUser(false)
    const wrapper = render()

    expect(wrapper.find('.api-keys-section-stub').exists()).toBe(false)
  })

  it('still lists the keys minted before the scope was switched off', async () => {
    // The toggle fails closed, but a key an operator already minted stays
    // listable and revocable: the page renders its section whatever the
    // toggle says.
    setAuthUser(true)
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.initialized = true
    runtimeConfig.globalApiEnabled = false
    vi.mocked(apiKeysApi.list).mockResolvedValue([globalKey])

    const wrapper = renderWithTheSection()
    await flushPromises()

    expect(wrapper.get('[data-testid="api-key-row-g1"]').text()).toContain('install-wide')
    // The warning explains the 404 rather than standing in for the page.
    expect(wrapper.text()).toContain('the Global API setting is off')
  })

  it('offers no way to mint a key while the scope is off', async () => {
    // The scope's surface is not mounted, so a key minted now would answer 404.
    setAuthUser(true)
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.initialized = true
    runtimeConfig.globalApiEnabled = false
    vi.mocked(apiKeysApi.list).mockResolvedValue([globalKey])

    const wrapper = renderWithTheSection()
    await flushPromises()

    expect(wrapper.find('[data-testid="new-api-key"]').exists()).toBe(false)
    // Only minting is gated — the keys stay listable and revocable.
    expect(wrapper.get('[data-testid="api-key-row-g1"]').text()).toContain('install-wide')
    expect(wrapper.find('[data-testid="revoke-api-key-g1"]').exists()).toBe(true)
  })

  it('offers to mint a key while the scope is on', async () => {
    setAuthUser(true)
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.initialized = true
    runtimeConfig.globalApiEnabled = true
    vi.mocked(apiKeysApi.list).mockResolvedValue([globalKey])

    const wrapper = renderWithTheSection()
    await flushPromises()

    expect(wrapper.find('[data-testid="new-api-key"]').exists()).toBe(true)
  })
})
