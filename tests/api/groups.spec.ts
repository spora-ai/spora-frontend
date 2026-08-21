import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    put: vi.fn(),
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

  it('addMember posts /groups/{groupId}/members with user_id payload', async () => {
    mockApi.post.mockResolvedValueOnce({ member: mockMember })
    const member = await groupsApi.addMember(1, { user_id: 42 }, 'member')
    expect(member).toEqual(mockMember)
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/members', { user_id: 42, role: 'member' })
  })

  it('addMember posts /groups/{groupId}/members with email payload', async () => {
    mockApi.post.mockResolvedValueOnce({ member: mockMember })
    const member = await groupsApi.addMember(1, { email: 'alice@example.com' }, 'admin')
    expect(member).toEqual(mockMember)
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/members', { email: 'alice@example.com', role: 'admin' })
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

  it('agents fetches /groups/{groupId}/agents and returns the wire shape', async () => {
    mockApi.get.mockResolvedValueOnce({ agents: [{ id: 5 }], total: 1 })
    const result = await groupsApi.agents(1)
    expect(result).toEqual({ agents: [{ id: 5 }], total: 1 })
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1/agents')
  })

  it('preferences fetches /groups/{groupId}/preferences and unwraps response', async () => {
    mockApi.get.mockResolvedValueOnce({ preference: { principal_id: 10, preferred_llm_config_id: 7 } })
    const pref = await groupsApi.preferences(1)
    expect(pref).toEqual({ principal_id: 10, preferred_llm_config_id: 7 })
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1/preferences')
  })

  it('upsertPreferences puts /groups/{groupId}/preferences and unwraps response', async () => {
    mockApi.put.mockResolvedValueOnce({ preference: { principal_id: 10, preferred_llm_config_id: null } })
    const pref = await groupsApi.upsertPreferences(1, { preferred_llm_config_id: null })
    expect(pref).toEqual({ principal_id: 10, preferred_llm_config_id: null })
    expect(mockApi.put).toHaveBeenCalledWith('/groups/1/preferences', { preferred_llm_config_id: null })
  })

  it('tools fetches /groups/{groupId}/tools and unwraps tool_settings', async () => {
    mockApi.get.mockResolvedValueOnce({ tool_settings: [{ tool_class: 'X', settings: {} }] })
    const list = await groupsApi.tools(1)
    expect(list).toEqual([{ tool_class: 'X', settings: {} }])
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1/tools')
  })

  it('tools tolerates a missing tool_settings array', async () => {
    mockApi.get.mockResolvedValueOnce({})
    const list = await groupsApi.tools(1)
    expect(list).toEqual([])
  })

  it('upsertTool posts /groups/{groupId}/tools/{toolClass} (URL-encoded) and unwraps', async () => {
    mockApi.post.mockResolvedValueOnce({ tool_setting: { tool_class: 'My/Tool', settings: { k: 'v' } } })
    const ts = await groupsApi.upsertTool(1, 'My/Tool', { k: 'v' })
    expect(ts).toEqual({ tool_class: 'My/Tool', settings: { k: 'v' } })
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/tools/My%2FTool', { settings: { k: 'v' } })
  })

  it('deleteTool deletes /groups/{groupId}/tools/{toolClass} (URL-encoded)', async () => {
    mockApi.delete.mockResolvedValueOnce(undefined)
    await groupsApi.deleteTool(1, 'My/Tool')
    expect(mockApi.delete).toHaveBeenCalledWith('/groups/1/tools/My%2FTool')
  })

  it('llmConfigs fetches /groups/{groupId}/llm-configs and unwraps configs', async () => {
    mockApi.get.mockResolvedValueOnce({ configs: [{ id: 1, name: 'C' }] })
    const list = await groupsApi.llmConfigs(1)
    expect(list).toEqual([{ id: 1, name: 'C' }])
    expect(mockApi.get).toHaveBeenCalledWith('/groups/1/llm-configs')
  })

  it('llmConfigs tolerates a missing configs array', async () => {
    mockApi.get.mockResolvedValueOnce({})
    const list = await groupsApi.llmConfigs(1)
    expect(list).toEqual([])
  })

  it('createLlmConfig posts /groups/{groupId}/llm-configs and unwraps response', async () => {
    mockApi.post.mockResolvedValueOnce({ config: { id: 2, name: 'C2' } })
    const config = await groupsApi.createLlmConfig(1, { name: 'C2', driver_class: 'D', settings: {} })
    expect(config).toEqual({ id: 2, name: 'C2' })
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/llm-configs', { name: 'C2', driver_class: 'D', settings: {} })
  })

  it('updateLlmConfig patches /groups/{groupId}/llm-configs/{configId} and unwraps response', async () => {
    mockApi.patch.mockResolvedValueOnce({ config: { id: 2, name: 'Renamed' } })
    const config = await groupsApi.updateLlmConfig(1, 2, { name: 'Renamed' })
    expect(config).toEqual({ id: 2, name: 'Renamed' })
    expect(mockApi.patch).toHaveBeenCalledWith('/groups/1/llm-configs/2', { name: 'Renamed' })
  })

  it('deleteLlmConfig deletes /groups/{groupId}/llm-configs/{configId}', async () => {
    mockApi.delete.mockResolvedValueOnce(undefined)
    await groupsApi.deleteLlmConfig(1, 2)
    expect(mockApi.delete).toHaveBeenCalledWith('/groups/1/llm-configs/2')
  })

  it('setDefaultLlmConfig posts to /.../set-default and unwraps response', async () => {
    mockApi.post.mockResolvedValueOnce({ config: { id: 2, is_default: true } })
    const config = await groupsApi.setDefaultLlmConfig(1, 2)
    expect(config).toEqual({ id: 2, is_default: true })
    expect(mockApi.post).toHaveBeenCalledWith('/groups/1/llm-configs/2/set-default')
  })

  it('patchProfilePicture patches /groups/{id} with profile_picture payload', async () => {
    mockApi.patch.mockResolvedValueOnce({ group: { ...mockGroup, profile_picture: { kind: 'avatar', archetype: 'researcher' } } })
    const updated = await groupsApi.patchProfilePicture(1, { archetype: 'researcher', variant_key: 'v1' })
    expect(updated.profile_picture.archetype).toBe('researcher')
    expect(mockApi.patch).toHaveBeenCalledWith('/groups/1', {
      profile_picture: { archetype: 'researcher', variant_key: 'v1' },
    })
  })

  it('uploadProfilePictureImage posts multipart /groups/{id}/picture/image', async () => {
    mockApi.postForm.mockResolvedValueOnce({ group: { ...mockGroup, profile_picture: { kind: 'image', image_url: '/media/x.png' } } })
    const file = new File(['fake'], 'p.png', { type: 'image/png' })
    const updated = await groupsApi.uploadProfilePictureImage(1, file)
    expect(updated.profile_picture.kind).toBe('image')
    expect(mockApi.postForm).toHaveBeenCalledWith('/groups/1/picture/image', expect.any(FormData))
  })

  it('removeProfilePictureImage deletes /groups/{id}/picture/image', async () => {
    mockApi.delete.mockResolvedValueOnce({ group: mockGroup })
    const updated = await groupsApi.removeProfilePictureImage(1)
    expect(updated).toEqual(mockGroup)
    expect(mockApi.delete).toHaveBeenCalledWith('/groups/1/picture/image')
  })
})
