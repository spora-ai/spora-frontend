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
const createGroupMock = vi.fn()
const groupsLoading = ref(false)
const groupsError = ref<string | null>(null)
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get groups() { return groupsRef.value },
    get loading() { return groupsLoading.value },
    get error() { return groupsError.value },
    fetchGroups: fetchGroupsMock,
    createGroup: createGroupMock,
  }),
}))

const authUser = ref<{ id: number; email: string; roles: string[]; is_admin?: boolean } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return authUser.value },
    get csrfToken() { return null },
    get initialized() { return true },
  }),
}))

const runtimeAllowGroupCreation = ref<boolean>(true)
vi.mock('@/stores/runtimeConfig', () => ({
  useRuntimeConfigStore: () => ({
    get allowGroupCreation() { return runtimeAllowGroupCreation.value },
    get initialized() { return true },
    init: () => Promise.resolve(),
    get workerRuntimeMode() { return 'server' },
    get clientWorker() {
      return {
        enabled: false,
        tick_endpoint: '/api/v1/tasks/{taskId}/tick',
        housekeeping_endpoint: '/api/v1/worker/housekeeping',
        housekeeping_interval_seconds: 300,
        tick_interval_ms: 2000,
        tick_lease_seconds: 600,
      }
    },
  }),
}))

vi.mock('@/stores/clientWorker', () => ({
  useClientWorkerStore: () => ({
    get status() { return 'idle' },
    get isServerMode() { return true },
    get isActive() { return false },
    get isDegraded() { return false },
    get isError() { return false },
    get degradedReason() { return null },
    setStatus: () => {},
    setDrivenTaskCount: () => {},
  }),
}))

vi.mock('@/composables/useClientWorker', () => ({
  useClientWorker: () => Promise.resolve(),
  postConsiderTask: () => {},
  postDropTask: () => {},
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}))

import MyGroupsPage from '@/pages/MyGroupsPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  pushMock.mockReset()
  fetchGroupsMock.mockReset()
  fetchGroupsMock.mockResolvedValue(undefined)
  createGroupMock.mockReset()
  createGroupMock.mockImplementation(async (payload) => ({
    id: 99,
    name: payload.name,
    description: payload.description ?? null,
    principal_id: 99,
    member_count: 1,
  }))
  toastSuccessMock.mockReset()
  toastErrorMock.mockReset()
  groupsRef.value = []
  groupsLoading.value = false
  groupsError.value = null
  authUser.value = null
  runtimeAllowGroupCreation.value = true
})

describe('MyGroupsPage', () => {
  it('fetches groups on mount if the cache is empty', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    mount(MyGroupsPage)
    await flushPromises()
    expect(fetchGroupsMock).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch when the cache is already populated', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    groupsRef.value = [{ id: 1, name: 'Cached', description: null, principal_id: 5, member_count: 2 }]
    mount(MyGroupsPage)
    await flushPromises()
    expect(fetchGroupsMock).not.toHaveBeenCalled()
  })

  it('renders one card per group and navigates on click', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
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

  it('shows the Create-group button + Admin overview link for admins', async () => {
    authUser.value = { id: 1, email: 'admin@spora.local', roles: ['ADMIN'], is_admin: true }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No groups yet')
    expect(wrapper.text()).toContain('Create group')
    expect(wrapper.text()).toContain('Admin overview')
    // The admin CTA no longer points at /settings/admin/groups — the
    // Create-group modal lives on MyGroupsPage now. The Admin overview
    // link is the secondary path.
    expect(wrapper.text()).not.toContain('Create your first group')
  })

  it('shows the Create-group button for non-admins when allowGroupCreation is true', async () => {
    authUser.value = { id: 1, email: 'user@spora.local', roles: ['USER'], is_admin: false }
    runtimeAllowGroupCreation.value = true
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Create group')
    expect(wrapper.text()).not.toContain('Admin overview')
  })

  it('hides the Create-group button for non-admins when allowGroupCreation is false', async () => {
    authUser.value = { id: 1, email: 'user@spora.local', roles: ['USER'], is_admin: false }
    runtimeAllowGroupCreation.value = false
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Create group')
    expect(wrapper.text()).not.toContain('Admin overview')
  })

  it('hides the Create-group button entirely for guests', async () => {
    authUser.value = null
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Create group')
  })

  it('shows an error banner if the fetch fails and the cache is empty', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    groupsError.value = 'network down'
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('network down')
  })

  it('opens the create modal when an admin clicks the Create-group button', async () => {
    authUser.value = { id: 1, email: 'admin@spora.local', roles: ['ADMIN'], is_admin: true }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="create-group-button"]').exists()).toBe(true)
    await wrapper.find('[data-testid="create-group-button"]').trigger('click')
    await flushPromises()
    // The Modal uses <Teleport to="body">, so the inputs render outside
    // the wrapper's root. Query document.body for the modal content.
    expect(document.body.querySelector('[data-testid="create-my-group-name"]')).not.toBeNull()
  })

  it('renders an avatar for each group card with an initials fallback', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    groupsRef.value = [
      { id: 1, name: 'Engineering', description: null, principal_id: 5, member_count: 4 },
      { id: 2, name: 'Operations', description: null, principal_id: 6, member_count: 1 },
    ]
    const wrapper = mount(MyGroupsPage)
    await flushPromises()

    // The Avatar component renders a [data-testid="avatar-initials"] span
    // in the initials-fallback branch — one per card.
    const initials = wrapper.findAll('[data-testid="avatar-initials"]')
    expect(initials.length).toBe(2)
    expect(initials[0]!.text()).toBe('E')
    expect(initials[1]!.text()).toBe('O')
  })

  it('falls back to "?" when the group name is blank', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    groupsRef.value = [
      { id: 7, name: '', description: null, principal_id: 11, member_count: 0 },
    ]
    const wrapper = mount(MyGroupsPage)
    await flushPromises()

    const initials = wrapper.findAll('[data-testid="avatar-initials"]')
    expect(initials.length).toBe(1)
    expect(initials[0]!.text()).toBe('?')
  })

  it('labels "member" vs "members" based on group.member_count', async () => {
    authUser.value = { id: 1, email: 'alice@example.com', roles: ['USER'], is_admin: false }
    groupsRef.value = [
      { id: 1, name: 'Solo', description: null, principal_id: 5, member_count: 1 },
      { id: 2, name: 'Crowd', description: null, principal_id: 6, member_count: 4 },
    ]
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('1 member')
    expect(wrapper.text()).toContain('4 members')
  })

  it('renders the "Create group" button label when not submitting', async () => {
    authUser.value = { id: 1, email: 'admin@spora.local', roles: ['ADMIN'], is_admin: true }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    await wrapper.find('[data-testid="create-group-button"]').trigger('click')
    await flushPromises()
    const submitBtn = document.body.querySelector('[data-testid="create-my-group-submit"]') as HTMLElement | null
    expect(submitBtn?.textContent?.trim()).toBe('Create group')
  })

  it('submits the create form and navigates to the new group on success', async () => {
    authUser.value = { id: 1, email: 'admin@spora.local', roles: ['ADMIN'], is_admin: true }
    groupsRef.value = []
    const wrapper = mount(MyGroupsPage)
    await flushPromises()
    await wrapper.find('[data-testid="create-group-button"]').trigger('click')
    await flushPromises()
    const nameInput = document.body.querySelector('[data-testid="create-my-group-name"]') as HTMLInputElement | null
    expect(nameInput).not.toBeNull()
    ;(nameInput as HTMLInputElement).value = 'Platform Team'
    await nameInput?.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const submitBtn = document.body.querySelector('[data-testid="create-my-group-submit"]') as HTMLElement | null
    expect(submitBtn).not.toBeNull()
    ;(submitBtn as HTMLElement).click()
    await flushPromises()
    expect(createGroupMock).toHaveBeenCalledWith({ name: 'Platform Team', description: undefined })
    expect(pushMock).toHaveBeenCalledWith({ name: 'group-overview', params: { id: '99' } })
    expect(toastSuccessMock).toHaveBeenCalled()
  })
})