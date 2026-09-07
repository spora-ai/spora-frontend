/**
 * GroupsPage interaction tests — exercises the script-setup handlers
 * directly via wrapper.vm rather than driving Modals through Teleport.
 * Modals are stubbed so the DOM contract is verified by component-level
 * integration tests elsewhere.
 *
 * The Open-group icon and the per-row "Manage members" navigation
 * have been replaced: the name cell is now a RouterLink guarded by
 * `my_role` (so admins who are members navigate, admins who aren't
 * see plain text), and member management opens `GroupMembersModal`
 * in place rather than routing. The modal itself is stubbed here.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
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
const fetchGroupsMock = vi.fn().mockResolvedValue([])

const groupsRef = vi.hoisted(() => ({ value: [] as unknown[] }))

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
  member_count: 3,
}

function makeGroup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'Eng',
    description: 'Engineering',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    members: [],
    my_role: 'owner',
    member_count: 3,
    ...overrides,
  }
}

describe('GroupsPage', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    groupsRef.value = []
    createGroupMock.mockResolvedValue({ ...adminGroup, id: 99 })
    updateGroupMock.mockResolvedValue({ ...adminGroup, name: 'Renamed' })
    deleteGroupMock.mockResolvedValue(undefined)
    setAuthUser(true)
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  it('loads groups on mount', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(fetchGroupsMock).toHaveBeenCalled()
  })

  it('renders the AdminForbidden component for a non-admin user', async () => {
    setAuthUser(false)
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, AdminSection: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Forbidden')
  })

  it('renders the empty-state when no groups exist', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('No groups found.')
  })

  it('surfaces mount-time load failures via toast', async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(toastErrorMock).toHaveBeenCalled()
  })

  it('createGroup() invokes the store and surfaces success', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = 'NewGrp'
    wrapper.vm.createForm.description = 'Desc'
    await wrapper.vm.createGroup()
    expect(createGroupMock).toHaveBeenCalledWith({ name: 'NewGrp', description: 'Desc' })
  })

  it('createGroup() surfaces errors in createError ref', async () => {
    createGroupMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = 'NewGrp'
    await wrapper.vm.createGroup()
    expect(wrapper.vm.createError).toBe('boom')
  })

  it('managingGroup opens the GroupMembersModal (overlay, not navigation)', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.managingGroup = adminGroup
    expect(wrapper.vm.isMembersOpen).toBe(true)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('openEdit() seeds the edit form', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    expect(wrapper.vm.editingGroup?.id).toBe(adminGroup.id)
    expect(wrapper.vm.editForm.name).toBe('Eng')
    expect(wrapper.vm.isEditingOpen).toBe(true)
  })

  it('saveEdit() invokes the updateGroup store action', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    wrapper.vm.editForm.name = 'Renamed'
    await wrapper.vm.saveEdit()
    expect(updateGroupMock).toHaveBeenCalledWith(adminGroup.id, { name: 'Renamed', description: 'Engineering' })
  })

  it('saveEdit() surfaces errors', async () => {
    updateGroupMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 500))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    wrapper.vm.editForm.name = 'X'
    await wrapper.vm.saveEdit()
    expect(wrapper.vm.editError).toBe('nope')
  })

  it('confirmDelete() invokes deleteGroup', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.deletingGroup = adminGroup
    await wrapper.vm.confirmDelete()
    expect(deleteGroupMock).toHaveBeenCalledWith(adminGroup.id)
    expect(wrapper.vm.isDeleteOpen).toBe(false)
  })

  it('confirmDelete() is a no-op when no group is selected', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    await wrapper.vm.confirmDelete()
    expect(deleteGroupMock).not.toHaveBeenCalled()
  })

  it('createGroup() returns early when name is empty', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = '   '
    await wrapper.vm.createGroup()
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('createGroup() falls back to a generic message for non-ApiError errors', async () => {
    createGroupMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.createForm.name = 'NewGrp'
    await wrapper.vm.createGroup()
    expect(wrapper.vm.createError).toBe('Failed to create group.')
  })

  it('confirmDelete() surfaces delete failures', async () => {
    deleteGroupMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 409))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.deletingGroup = adminGroup
    await wrapper.vm.confirmDelete()
    expect(toastErrorMock).toHaveBeenCalledWith('nope')
    expect(wrapper.vm.isDeleteOpen).toBe(true)
  })

  it('confirmDelete() surfaces non-ApiError failures', async () => {
    deleteGroupMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.deletingGroup = adminGroup
    await wrapper.vm.confirmDelete()
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to delete group.')
  })

  it('saveEdit() returns early when no editing group is set', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    await wrapper.vm.saveEdit()
    expect(updateGroupMock).not.toHaveBeenCalled()
  })

  it('saveEdit() falls back to a generic message for non-ApiError errors', async () => {
    updateGroupMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.openEdit(adminGroup)
    wrapper.vm.editForm.name = 'X'
    await wrapper.vm.saveEdit()
    expect(wrapper.vm.editError).toBe('Failed to update group.')
  })

  it('onMounted surfaces non-ApiError failures with a generic toast', async () => {
    fetchGroupsMock.mockRejectedValueOnce(new Error('boom'))
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to load groups.')
  })

  it('close handlers reset the underlying refs through the computed setters', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.editingGroup = adminGroup
    wrapper.vm.deletingGroup = adminGroup
    wrapper.vm.managingGroup = adminGroup
    wrapper.vm.isEditingOpen = false
    wrapper.vm.isDeleteOpen = false
    wrapper.vm.isMembersOpen = false
    expect(wrapper.vm.editingGroup).toBeNull()
    expect(wrapper.vm.deletingGroup).toBeNull()
    expect(wrapper.vm.managingGroup).toBeNull()
  })

  it('renders a sort dropdown defaulting to name order', async () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    const sort = wrapper.find('[data-testid="group-sort"]')
    expect(sort.exists()).toBe(true)
    expect((sort.element as HTMLSelectElement).value).toBe('name')
  })

  it('sortedGroups orders alphabetically by name (the backend default)', async () => {
    groupsRef.value = [
      makeGroup({ id: 3, name: 'Charlie' }),
      makeGroup({ id: 1, name: 'Alpha' }),
      makeGroup({ id: 2, name: 'Bravo' }),
    ]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(wrapper.vm.sortedGroups.map((g: { id: number }) => g.id)).toEqual([1, 2, 3])
  })

  it('sortBy "recent" puts the newest created_at first, with name as tiebreaker', async () => {
    groupsRef.value = [
      makeGroup({ id: 1, name: 'Older', created_at: '2026-01-01T00:00:00Z' }),
      makeGroup({ id: 2, name: 'Newest', created_at: '2026-03-01T00:00:00Z' }),
      makeGroup({ id: 3, name: 'Middle', created_at: '2026-02-01T00:00:00Z' }),
    ]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.sortBy = 'recent'
    expect(wrapper.vm.sortedGroups.map((g: { id: number }) => g.id)).toEqual([2, 3, 1])
  })

  it('sortBy "recent" falls back to name when timestamps tie', async () => {
    groupsRef.value = [
      makeGroup({ id: 1, name: 'Bravo', created_at: '2026-01-01T00:00:00Z' }),
      makeGroup({ id: 2, name: 'Alpha', created_at: '2026-01-01T00:00:00Z' }),
    ]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    wrapper.vm.sortBy = 'recent'
    expect(wrapper.vm.sortedGroups.map((g: { id: number }) => g.id)).toEqual([2, 1])
  })

  it('changing the sort dropdown reorders the rendered rows', async () => {
    groupsRef.value = [
      makeGroup({ id: 1, name: 'Alpha', created_at: '2026-01-01T00:00:00Z' }),
      makeGroup({ id: 2, name: 'Bravo', created_at: '2026-03-01T00:00:00Z' }),
    ]
    wrapper = mount(GroupsPage, {
      global: {
        stubs: {
          Icon: true,
          GroupMembersModal: true,
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()
    // Default: alphabetical. Name cell renders RouterLink (stubbed as <a>).
    expect(wrapper.findAll('tbody tr td.font-medium a').map((a) => a.text())).toEqual([
      'Alpha',
      'Bravo',
    ])

    await wrapper.find('[data-testid="group-sort"]').setValue('recent')
    expect(wrapper.findAll('tbody tr td.font-medium a').map((a) => a.text())).toEqual([
      'Bravo',
      'Alpha',
    ])
  })

  it('renders a RouterLink for the name when the caller has my_role', async () => {
    groupsRef.value = [makeGroup({ id: 1, name: 'Eng', my_role: 'owner' })]
    wrapper = mount(GroupsPage, {
      global: {
        stubs: {
          Icon: true,
          GroupMembersModal: true,
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()
    const link = wrapper.find('tbody tr td.font-medium a')
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('Eng')
  })

  it('renders plain text for the name when the caller has no my_role (admin non-member)', async () => {
    groupsRef.value = [makeGroup({ id: 1, name: 'Eng', my_role: undefined })]
    wrapper = mount(GroupsPage, {
      global: {
        stubs: {
          Icon: true,
          GroupMembersModal: true,
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()
    const cell = wrapper.find('tbody tr td.font-medium')
    expect(cell.find('a').exists()).toBe(false)
    expect(cell.text()).toBe('Eng')
  })

  it('does not render the Open-group icon button (replaced by RouterLink/span + overlay)', async () => {
    groupsRef.value = [makeGroup({ id: 1, name: 'Eng' })]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    expect(wrapper.find('button[title="Open group"]').exists()).toBe(false)
  })

  it('renders an Avatar (initials fallback) for each group row', async () => {
    groupsRef.value = [
      makeGroup({ id: 1, name: 'Eng' }),
      makeGroup({ id: 2, name: 'Ops' }),
    ]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    // Two avatars, one per row.
    const avatars = wrapper.findAllComponents({ name: 'Avatar' })
    expect(avatars).toHaveLength(2)
    // The Avatar component falls back to initials when no profile_picture
    // is present — assert the initials are bound (sm size, first letter
    // uppercase of each group name).
    expect(avatars[0].props('initials')).toBe('E')
    expect(avatars[1].props('initials')).toBe('O')
    expect(avatars[0].props('size')).toBe('sm')
  })

  it('passes the group profile_picture through to Avatar', async () => {
    const picture = {
      kind: 'avatar' as const,
      archetype: 'researcher',
      variant_key: 'v1',
      palette_key: 'blue',
      fg_color: '#fff',
      bg_color: '#1e40af',
    }
    groupsRef.value = [makeGroup({ id: 1, name: 'Eng', profile_picture: picture })]
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    await flushPromises()
    const avatar = wrapper.findComponent({ name: 'Avatar' })
    expect(avatar.props('profilePicture')).toEqual(picture)
  })

  it('groupInitials returns "?" for empty or whitespace names', () => {
    wrapper = mount(GroupsPage, { global: { stubs: { Icon: true, GroupMembersModal: true } } })
    expect(wrapper.vm.groupInitials('')).toBe('?')
    expect(wrapper.vm.groupInitials('   ')).toBe('?')
    expect(wrapper.vm.groupInitials(null)).toBe('?')
    expect(wrapper.vm.groupInitials(undefined)).toBe('?')
    expect(wrapper.vm.groupInitials('research')).toBe('R')
    expect(wrapper.vm.groupInitials('  ops  ')).toBe('O')
  })
})
