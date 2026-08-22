import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const groupsRef = ref<Array<{
  id: number; name: string; description: string | null;
  principal_id: number | null; member_count?: number
}>>([])
const fetchGroupsMock = vi.fn()
const groupsLoading = ref(false)
const groupsError = ref<string | null>(null)
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get groups() { return groupsRef.value },
    get loading() { return groupsLoading.value },
    get error() { return groupsError.value },
    fetchGroups: fetchGroupsMock,
  }),
}))

const authUser = ref<{ id: number; email: string; roles: string[] } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ get user() { return authUser.value } }),
}))

import MyGroupsPage from '@/pages/MyGroupsPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  pushMock.mockReset()
  fetchGroupsMock.mockReset()
  fetchGroupsMock.mockResolvedValue(undefined)
  groupsRef.value = []
  groupsLoading.value = false
  groupsError.value = null
  authUser.value = null
})

describe('MyGroupsPage', () => {
  it('fetches groups on mount if the cache is empty', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'] }
    mount(MyGroupsPage)
    await flushPromises()
    expect(fetchGroupsMock).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch when the cache is already populated', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'] }
    groupsRef.value = [{ id: 1, name: 'Cached', description: null, principal_id: 5, member_count: 2 }]
    mount(MyGroupsPage)
    await flushPromises()
    expect(fetchGroupsMock).not.toHaveBeenCalled()
  })

  it('renders one card per group and navigates on click', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'] }
    groupsRef.value = [
      { id: 1, name: 'Engineering', description: 'Builds Spora.', principal_id: 5, member_count: 4 },
      { id: 2, name: 'Operations', description: null, principal_id: 6, member_count: 1 },
    ]
    const wrapper = mount(MyGroupsPage, {
      global: { mocks: { $router: { push: pushMock } } },
    })
    await flushPromises()

    const cards = wrapper.findAll('button').filter((b) => b.text().includes('Engineering') || b.text().includes('Operations'))
    expect(cards.length).toBe(2)

    await cards[0]!.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'group-overview', params: { id: '1' } })
  })

  it('shows the empty state with an admin CTA for admins', async () => {
    authUser.value = { id: 1, email: 'admin@spora.local', roles: ['ADMIN'] }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No groups yet')
    expect(wrapper.text()).toContain('Create your first group')
    expect(wrapper.text()).toContain('Admin overview')
  })

  it('hides the admin CTA for non-admins', async () => {
    authUser.value = { id: 1, email: 'user@spora.local', roles: ['USER'] }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No groups yet')
    expect(wrapper.text()).not.toContain('Create your first group')
    expect(wrapper.text()).not.toContain('Admin overview')
  })

  it('shows an error banner if the fetch fails and the cache is empty', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'] }
    groupsError.value = 'network down'
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('network down')
  })
})
