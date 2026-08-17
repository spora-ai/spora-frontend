/**
 * GroupsPage interaction tests — exercises the script-setup handlers
 * directly via wrapper.vm rather than driving Modals through Teleport.
 * Modals are stubbed so the DOM contract is verified by component-level
 * integration tests elsewhere.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}))

const { useAuthStore } = await import('@/stores/auth')
const setAuthUser = (is_admin: boolean) => {
  vi.mocked(useAuthStore).mockReturnValue({
    user: { id: 1, email: is_admin ? 'admin@x.com' : 'user@x.com', name: is_admin ? 'Admin' : 'User', roles: [is_admin ? 'ADMIN' : 'USER'], is_admin },
  })
}

const createGroupMock = vi.fn()
const updateGroupMock = vi.fn()
const deleteGroupMock = vi.fn()
const addMemberMock = vi.fn()
const updateMemberMock = vi.fn()
const removeMemberMock = vi.fn()
const fetchGroupsMock = vi.fn().mockResolvedValue([])
const fetchMembersMock = vi.fn().mockResolvedValue([])
const fetchUsersMock = vi.fn().mockResolvedValue([])

const groupsRef = vi.hoisted(() => ({ value: [] as any[] }))

vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get groups() { return groupsRef.value },
    loading: false,
    saving: false,
    error: null,
    fetchGroups: fetchGroupsMock,
    fetchGroup: vi.fn(),
    createGroup: createGroupMock,
    updateGroup: updateGroupMock,
    deleteGroup: deleteGroupMock,
    fetchMembers: fetchMembersMock,
    addMember: addMemberMock,
    updateMember: updateMemberMock,
    removeMember: removeMemberMock,
  }),
}))

const usersRef = vi.hoisted(() => ({ value: [] as any[] }))

vi.mock('@/stores/users', () => ({
  useUsersStore: () => ({
    get users() { return usersRef.value },
    fetchUsers: fetchUsersMock,
  }),
}))

const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: toastErrorMock, success: toastSuccessMock }),
}))

import { ApiError } from '@/api/client'
import GroupsPage from '@/pages/admin/GroupsPage.vue'

const adminGroup = {
  id: 1,
  name: 'Eng',
  description: 'Engineering',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  members: [],
  my_role: 'owner',
}

const sampleMember = {
  user_id: 42,
  email: 'a@example.com',
  name: 'Alice',
  role: 'member',
  joined_at: '2026-01-01T00:00:00Z',
}

const sampleUser = {
  id: 7,
  email: 'carol@example.com',
  username: 'carol',
  is_admin: false,
  roles: ['USER'],
}

describe('GroupsPage', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    groupsRef.value = []
    usersRef.value = [sampleUser]
    createGroupMock.mockResolvedValue({ ...adminGroup, id: 99 })
    updateGroupMock.mockResolvedValue({ ...adminGroup, name: 'Renamed' })
    addMemberMock.mockResolvedValue(sampleMember)
    updateMemberMock.mockResolvedValue({ ...sampleMember, role: 'admin' })
    deleteGroupMock.mockResolvedValue(undefined)
    removeMemberMock.mockResolvedValue(undefined)
    setAuthUser(true)
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  it('loads groups + users on mount', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    expect(fetchGroupsMock).toHaveBeenCalled()
    expect(fetchUsersMock).toHaveBeenCalledWith(1)
  })

  it('renders the AdminForbidden component for a non-admin user', async () => {
    setAuthUser(false)
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true, AdminSection: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Forbidden')
  })

  it('renders the empty-state when no groups exist', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('No groups found.')
  })

  it('surfaces mount-time load failures via toast', async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    expect(toastErrorMock).toHaveBeenCalled()
  })

  it('createGroup() invokes the store and surfaces success', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = 'NewGrp'
    wrapper.vm.createForm.description = 'Desc'
    await wrapper.vm.createGroup()
    expect(createGroupMock).toHaveBeenCalledWith({ name: 'NewGrp', description: 'Desc' })
  })

  it('createGroup() surfaces errors in createError ref', async () => {
    createGroupMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = 'NewGrp'
    await wrapper.vm.createGroup()
    expect(wrapper.vm.createError).toBe('boom')
  })

  it('openGroup() loads members and selects the group', async () => {
    fetchMembersMock.mockResolvedValueOnce([sampleMember])
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    await wrapper.vm.openGroup({ ...adminGroup, members: [] })
    expect(fetchMembersMock).toHaveBeenCalledWith(adminGroup.id)
    expect(wrapper.vm.selectedGroup?.id).toBe(adminGroup.id)
    expect(wrapper.vm.isDetailsOpen).toBe(true)
  })

  it('openEdit() seeds the edit form', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    expect(wrapper.vm.editingGroup?.id).toBe(adminGroup.id)
    expect(wrapper.vm.editForm.name).toBe('Eng')
    expect(wrapper.vm.isEditingOpen).toBe(true)
  })

  it('saveEdit() invokes the updateGroup store action', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    wrapper.vm.editForm.name = 'Renamed'
    await wrapper.vm.saveEdit()
    expect(updateGroupMock).toHaveBeenCalledWith(adminGroup.id, { name: 'Renamed', description: 'Engineering' })
  })

  it('saveEdit() surfaces errors', async () => {
    updateGroupMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 500))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    wrapper.vm.editForm.name = 'X'
    await wrapper.vm.saveEdit()
    expect(wrapper.vm.editError).toBe('nope')
  })

  it('confirmDelete() invokes deleteGroup', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.deletingGroup = adminGroup
    await wrapper.vm.confirmDelete()
    expect(deleteGroupMock).toHaveBeenCalledWith(adminGroup.id)
    expect(wrapper.vm.isDeleteOpen).toBe(false)
  })

  it('confirmDelete() is a no-op when no group is selected', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    await wrapper.vm.confirmDelete()
    expect(deleteGroupMock).not.toHaveBeenCalled()
  })

  it('openAddMember() opens the modal and resets the form', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.openAddMember()
    expect(wrapper.vm.showAddMember).toBe(true)
    expect(wrapper.vm.addMemberForm.role).toBe('member')
  })

  it('submitAddMember() invokes addMember', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.selectedGroup = adminGroup
    wrapper.vm.addMemberForm = { user_id: 7, role: 'member' }
    await wrapper.vm.submitAddMember()
    expect(addMemberMock).toHaveBeenCalledWith(adminGroup.id, 7, 'member')
    expect(wrapper.vm.showAddMember).toBe(false)
  })

  it('submitAddMember() does nothing when no user is selected', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.selectedGroup = adminGroup
    wrapper.vm.addMemberForm = { user_id: null, role: 'member' }
    await wrapper.vm.submitAddMember()
    expect(addMemberMock).not.toHaveBeenCalled()
  })

  it('changeMemberRole() invokes updateMember with the new role', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.selectedGroup = { ...adminGroup, members: [sampleMember] }
    wrapper.vm.selectedGroupMembers = [sampleMember]
    await wrapper.vm.changeMemberRole(sampleMember, 'admin')
    expect(updateMemberMock).toHaveBeenCalledWith(adminGroup.id, 42, 'admin')
  })

  it('changeMemberRole() is a no-op without a selected group', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    await wrapper.vm.changeMemberRole(sampleMember, 'admin')
    expect(updateMemberMock).not.toHaveBeenCalled()
  })

  it('removeMember() invokes removeMember and updates state', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, RouterLink: true } } })
    await flushPromises()
    wrapper.vm.selectedGroup = { ...adminGroup, members: [sampleMember] }
    wrapper.vm.selectedGroupMembers = [sampleMember]
    await wrapper.vm.removeMember(sampleMember)
    expect(removeMemberMock).toHaveBeenCalledWith(adminGroup.id, 42)
    expect(wrapper.vm.selectedGroupMembers).toEqual([])
  })
})
