/**
 * GlobalApiKeysPage — the install-wide keys.
 *
 * A global key reaches every group, their agents and their chats: the widest
 * credential Spora issues. The page is therefore admin-only, and it says
 * plainly what such a key reaches — including what it does not.
 */
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/stores/auth', () => ({ useAuthStore: vi.fn() }))

const { useAuthStore } = await import('@/stores/auth')

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
})
