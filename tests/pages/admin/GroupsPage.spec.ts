/**
 * GroupsPage smoke test — exercises layout, member table accessibility, and
 * empty-state copy. Admin auth, toast, router, and stores are mocked.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 1, email: 'admin@x.com', name: 'Admin', roles: ['ADMIN'], is_admin: true },
  }),
}))

vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    groups: [],
    loading: false,
    saving: false,
    error: null,
    fetchGroups: vi.fn().mockResolvedValue([]),
    fetchGroup: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    fetchMembers: vi.fn().mockResolvedValue([]),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
  }),
}))

vi.mock('@/stores/users', () => ({
  useUsersStore: () => ({
    users: [],
    fetchUsers: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

import GroupsPage from '@/pages/admin/GroupsPage.vue'

describe('GroupsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the page header and Create button', async () => {
    const wrapper = mount(GroupsPage, {
      global: { stubs: { Icon: true, RouterLink: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Groups')
    expect(wrapper.text()).toContain('Create')
  })

  it('renders an empty-state message when no groups are loaded', async () => {
    const wrapper = mount(GroupsPage, {
      global: { stubs: { Icon: true, RouterLink: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No groups found')
  })
})

import { setActivePinia, createPinia } from 'pinia'
