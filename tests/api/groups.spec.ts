import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '@/api/client'
import { groupsApi } from '@/api/groups'

const mockApi = api as ReturnType<typeof vi.fn>

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

describe('groupsApi', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('list fetches /groups and unwraps response', async () => {
    mockApi.get.mockResolvedValueOnce({ groups: [mockGroup] })
    const list = await groupsApi.list()
    expect(list).toEqual([mockGroup])
    expect(mockApi.get).toHaveBeenCalledWith('/groups')
  })

  it('get fetches /groups/{id} and unwraps response', async () => {
    mockApi.get.mockResolvedValueOnce({ group: mockGroup })
    const group = await groupsApi.get(1)
    expect(group).toEqual(mockGroup)
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1')
  })

  it('create posts /groups and unwraps response', async () => {
    mockApi.post.mockResolvedValueOnce({ group: mockGroup })
    const group = await groupsApi.create({ name: 'Eng', description: 'Eng team' })
    expect(group).toEqual(mockGroup)
    expect(mockApi.post).toHaveBeenCalledWith('/groups', { name: 'Eng', description: 'Eng team' })
  })

  it('update patches /groups/{id} and unwraps response', async () => {
    mockApi.patch.mockResolvedValueOnce({ group: mockGroup })
    const group = await groupsApi.update(1, { name: 'New' })
    expect(group).toEqual(mockGroup)
    expect(mockApi.patch).toHaveBeenCalledWith('/groups/1', { name: 'New' })
  })

  it('remove deletes /groups/{id}', async () => {
    mockApi.delete.mockResolvedValueOnce(undefined)
    await groupsApi.remove(1)
    expect(mockApi.delete).toHaveBeenCalledWith('/groups/1')
  })

  it('listMembers fetches /groups/{groupId}/members and unwraps response', async () => {
    mockApi.get.mockResolvedValueOnce({ members: [mockMember] })
    const members = await groupsApi.listMembers(1)
    expect(members).toEqual([mockMember])
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1/members')
  })

  it('addMember posts /groups/{groupId}/members with payload', async () => {
    mockApi.post.mockResolvedValueOnce({ member: mockMember })
    const member = await groupsApi.addMember(1, 42, 'member')
    expect(member).toEqual(mockMember)
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/members', { user_id: 42, role: 'member' })
  })

  it('updateMember patches /groups/{groupId}/members/{userId}', async () => {
    mockApi.patch.mockResolvedValueOnce({ member: mockMember })
    const member = await groupsApi.updateMember(1, 42, 'admin')
    expect(member).toEqual(mockMember)
    expect(mockApi.patch).toHaveBeenCalledWith('/groups/1/members/42', { role: 'admin' })
  })

  it('removeMember deletes /groups/{groupId}/members/{userId}', async () => {
    mockApi.delete.mockResolvedValueOnce(undefined)
    await groupsApi.removeMember(1, 42)
    expect(mockApi.delete).toHaveBeenCalledWith('/groups/1/members/42')
  })
})
