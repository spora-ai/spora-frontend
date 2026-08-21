/**
 * GroupMembersPage — list + add + role-edit + remove for one group's members.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

interface DetailMock {
  group: Record<string, unknown> | null
  members: Array<Record<string, unknown>>
  agents: Array<unknown>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: { id: 1, name: 'Eng', description: null, principal_id: 10, my_role: 'owner' },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const fetchMembersMock = vi.fn().mockResolvedValue([])
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, { fetchMembers: fetchMembersMock })
    return detailStoreMock
  },
}))

const addMemberMock = vi.fn()
const updateMemberMock = vi.fn()
const removeMemberMock = vi.fn()
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    addMember: addMemberMock,
    updateMember: updateMemberMock,
    removeMember: removeMemberMock,
  }),
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import { ApiError } from '@/api/client'
import GroupMembersPage from '@/pages/groups/GroupMembersPage.vue'

const alice = { user_id: 42, email: 'alice@x.com', name: 'Alice', role: 'admin' }
const bob = { user_id: 7, email: 'bob@x.com', name: 'Bob', role: 'member' }

describe('GroupMembersPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    addMemberMock.mockResolvedValue(bob)
    updateMemberMock.mockResolvedValue({ ...alice, role: 'owner' })
    removeMemberMock.mockResolvedValue(undefined)
    fetchMembersMock.mockResolvedValue([alice, bob])
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads members on mount', async () => {
    detailStoreMock.members = [alice, bob]
    mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await flushPromises()
    expect(fetchMembersMock).toHaveBeenCalledWith(1)
  })

  it('renders the members fetched from the store', () => {
    detailStoreMock.members = [alice, bob]
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).toContain('alice@x.com')
    expect(wrapper.text()).toContain('Bob')
  })

  it('shows read-only role pills when the caller is a member only', () => {
    detailStoreMock.members = [alice, bob]
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.text()).toContain('admin')
    expect(wrapper.text()).toContain('member')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('renders role selects when the caller is admin', () => {
    detailStoreMock.members = [alice, bob]
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.findAll('select').length).toBeGreaterThan(0)
  })

  it('hides the Add Member button for member-only callers', () => {
    detailStoreMock.members = [alice, bob]
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.text()).not.toContain('Add Member')
  })

  it('changeRole() calls updateMember and updates the row', async () => {
    detailStoreMock.members = [alice, bob]
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await wrapper.vm.changeRole(alice, 'owner')
    expect(updateMemberMock).toHaveBeenCalledWith(1, alice.user_id, 'owner')
    expect(detailStoreMock.members.find((m) => m.user_id === alice.user_id)?.role).toBe('owner')
  })

  it('changeRole() surfaces ApiError via toast', async () => {
    updateMemberMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 403))
    detailStoreMock.members = [alice]
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await wrapper.vm.changeRole(alice, 'owner')
    expect(toastMock.error).toHaveBeenCalledWith('nope')
  })

  it('removeMember() calls removeMember and decrements the count', async () => {
    detailStoreMock.members = [alice, bob]
    detailStoreMock.group = { ...detailStoreMock.group, member_count: 2 }
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await wrapper.vm.removeMember(alice)
    expect(removeMemberMock).toHaveBeenCalledWith(1, alice.user_id)
    expect(detailStoreMock.members).toHaveLength(1)
    expect((detailStoreMock.group as Record<string, unknown>).member_count).toBe(1)
  })

  it('removeMember() surfaces ApiError via toast', async () => {
    removeMemberMock.mockRejectedValueOnce(new ApiError('cannot', 'ERROR', 409))
    detailStoreMock.members = [alice]
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await wrapper.vm.removeMember(alice)
    expect(toastMock.error).toHaveBeenCalledWith('cannot')
  })

  it('submitAdd() invokes addMember with the email payload and appends the new member', async () => {
    detailStoreMock.members = [alice]
    detailStoreMock.group = { ...detailStoreMock.group, member_count: 1 }
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.addEmail = 'newbie@example.com'
    wrapper.vm.addRole = 'member'
    await wrapper.vm.submitAdd()
    expect(addMemberMock).toHaveBeenCalledWith(1, { email: 'newbie@example.com' }, 'member')
    expect(detailStoreMock.members).toHaveLength(2)
    expect((detailStoreMock.group as Record<string, unknown>).member_count).toBe(2)
  })

  it('submitAdd() returns early when email is empty', async () => {
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.addEmail = '   '
    await wrapper.vm.submitAdd()
    expect(addMemberMock).not.toHaveBeenCalled()
  })

  it('submitAdd() trims whitespace from the email payload', async () => {
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.addEmail = '  spaced@example.com  '
    await wrapper.vm.submitAdd()
    expect(addMemberMock).toHaveBeenCalledWith(1, { email: 'spaced@example.com' }, 'member')
  })

  it('submitAdd() surfaces errors in the inline error ref', async () => {
    addMemberMock.mockRejectedValueOnce(new ApiError('fail', 'ERROR', 422))
    const wrapper = mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.addEmail = 'bad@example.com'
    await wrapper.vm.submitAdd()
    expect(wrapper.vm.addError).toBe('fail')
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchMembersMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupMembersPage, { global: { stubs: { Icon: true, Modal: true } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})
