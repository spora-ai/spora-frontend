import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/api/groups', () => ({
  groupsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
  },
}))

import { groupsApi } from '@/api/groups'
import { useGroupsStore } from '@/stores/groups'

const mockGroup = {
  id: 1,
  name: 'Engineering',
  description: 'Eng team',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  members: [],
  my_role: 'owner',
}

const mockMember = {
  user_id: 42,
  email: 'a@example.com',
  name: 'Alice',
  role: 'member',
  joined_at: '2026-01-01T00:00:00Z',
}

describe('useGroupsStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('fetchGroups loads groups and tracks loading state', async () => {
    vi.mocked(groupsApi.list).mockResolvedValueOnce([mockGroup])
    const store = useGroupsStore()
    const p = store.fetchGroups()
    expect(store.loading).toBe(true)
    await p
    expect(store.loading).toBe(false)
    expect(store.groups).toEqual([mockGroup])
    expect(store.error).toBeNull()
  })

  it('fetchGroups records error and rethrows', async () => {
    vi.mocked(groupsApi.list).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupsStore()
    await expect(store.fetchGroups()).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('fetchGroup upserts into the cache', async () => {
    vi.mocked(groupsApi.get).mockResolvedValueOnce({ ...mockGroup, name: 'Loaded' })
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, name: 'Old' }]

    const group = await store.fetchGroup(1)
    expect(group.name).toBe('Loaded')
    expect(store.groups[0].name).toBe('Loaded')
  })

  it('fetchGroup pushes into the cache when missing', async () => {
    vi.mocked(groupsApi.get).mockResolvedValueOnce(mockGroup)
    const store = useGroupsStore()
    const group = await store.fetchGroup(1)
    expect(store.groups).toContainEqual(mockGroup)
    expect(group).toBe(mockGroup)
  })

  it('createGroup prepends the new group', async () => {
    vi.mocked(groupsApi.create).mockResolvedValueOnce(mockGroup)
    const store = useGroupsStore()
    const group = await store.createGroup({ name: 'Eng' })
    expect(group).toBe(mockGroup)
    expect(store.groups).toContainEqual(mockGroup)
  })

  it('updateGroup replaces the cached entry', async () => {
    vi.mocked(groupsApi.update).mockResolvedValueOnce({ ...mockGroup, name: 'Renamed' })
    const store = useGroupsStore()
    store.groups = [mockGroup]
    const updated = await store.updateGroup(1, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(store.groups[0].name).toBe('Renamed')
  })

  it('deleteGroup removes the cached entry', async () => {
    vi.mocked(groupsApi.remove).mockResolvedValueOnce(undefined)
    const store = useGroupsStore()
    store.groups = [mockGroup, { ...mockGroup, id: 2 }]
    await store.deleteGroup(1)
    expect(store.groups.map((g) => g.id)).toEqual([2])
  })

  it('fetchMembers delegates to api', async () => {
    vi.mocked(groupsApi.listMembers).mockResolvedValueOnce([mockMember])
    const store = useGroupsStore()
    const members = await store.fetchMembers(1)
    expect(members).toEqual([mockMember])
    expect(groupsApi.listMembers).toHaveBeenCalledWith(1)
  })

  it('addMember bumps member_count on the cached group', async () => {
    vi.mocked(groupsApi.addMember).mockResolvedValueOnce(mockMember)
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, member_count: 1 }]
    const added = await store.addMember(1, { user_id: 42 }, 'member')
    expect(added).toBe(mockMember)
    expect(store.groups[0].member_count).toBe(2)
  })

  it('addMember initialises member_count when missing', async () => {
    vi.mocked(groupsApi.addMember).mockResolvedValueOnce(mockMember)
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, member_count: undefined }]
    await store.addMember(1, { user_id: 42 }, 'member')
    expect(store.groups[0].member_count).toBe(1)
  })

  it('updateMember returns the updated member but does not touch the cached members array', async () => {
    vi.mocked(groupsApi.updateMember).mockResolvedValueOnce({ ...mockMember, role: 'admin' })
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, member_count: 1 }]
    const updated = await store.updateMember(1, 42, 'admin')
    expect(updated.role).toBe('admin')
    // member_count unchanged by a role change
    expect(store.groups[0].member_count).toBe(1)
  })

  it('removeMember decrements member_count on the cached group', async () => {
    vi.mocked(groupsApi.removeMember).mockResolvedValueOnce(undefined)
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, member_count: 3 }]
    await store.removeMember(1, 42)
    expect(store.groups[0].member_count).toBe(2)
  })

  it('removeMember floors member_count at zero', async () => {
    vi.mocked(groupsApi.removeMember).mockResolvedValueOnce(undefined)
    const store = useGroupsStore()
    store.groups = [{ ...mockGroup, member_count: 0 }]
    await store.removeMember(1, 42)
    expect(store.groups[0].member_count).toBe(0)
  })

  it('records errors from fetchGroup', async () => {
    vi.mocked(groupsApi.get).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupsStore()
    await expect(store.fetchGroup(1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('records errors from createGroup', async () => {
    vi.mocked(groupsApi.create).mockRejectedValueOnce(new Error('boom-create'))
    const store = useGroupsStore()
    await expect(store.createGroup({ name: 'X' })).rejects.toThrow('boom-create')
    expect(store.error).toBe('boom-create')
  })

  it('records errors from updateGroup', async () => {
    vi.mocked(groupsApi.update).mockRejectedValueOnce(new Error('boom-update'))
    const store = useGroupsStore()
    await expect(store.updateGroup(1, { name: 'X' })).rejects.toThrow('boom-update')
    expect(store.error).toBe('boom-update')
  })

  it('records errors from deleteGroup', async () => {
    vi.mocked(groupsApi.remove).mockRejectedValueOnce(new Error('boom-delete'))
    const store = useGroupsStore()
    await expect(store.deleteGroup(1)).rejects.toThrow('boom-delete')
    expect(store.error).toBe('boom-delete')
  })

  it('records errors from addMember', async () => {
    vi.mocked(groupsApi.addMember).mockRejectedValueOnce(new Error('boom-add'))
    const store = useGroupsStore()
    await expect(store.addMember(1, { user_id: 42 }, 'member')).rejects.toThrow('boom-add')
    expect(store.error).toBe('boom-add')
  })

  it('records errors from updateMember', async () => {
    vi.mocked(groupsApi.updateMember).mockRejectedValueOnce(new Error('boom-updmem'))
    const store = useGroupsStore()
    await expect(store.updateMember(1, 42, 'admin')).rejects.toThrow('boom-updmem')
    expect(store.error).toBe('boom-updmem')
  })

  it('records errors from removeMember', async () => {
    vi.mocked(groupsApi.removeMember).mockRejectedValueOnce(new Error('boom-rm'))
    const store = useGroupsStore()
    await expect(store.removeMember(1, 42)).rejects.toThrow('boom-rm')
    expect(store.error).toBe('boom-rm')
  })
})
