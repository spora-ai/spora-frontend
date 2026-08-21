/**
 * groupDetail store — covers the per-group fetch/upsert/delete lifecycle.
 *
 * The store resets state when navigating away (called from GroupLayout's
 * onUnmounted hook); the tests below assume one Pinia instance per test
 * so the reset path is implicit.
 */
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/groups', () => ({
  groupsApi: {
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listMembers: vi.fn(),
    agents: vi.fn(),
    preferences: vi.fn(),
    upsertPreferences: vi.fn(),
    tools: vi.fn(),
    upsertTool: vi.fn(),
    deleteTool: vi.fn(),
    llmConfigs: vi.fn(),
    createLlmConfig: vi.fn(),
    updateLlmConfig: vi.fn(),
    deleteLlmConfig: vi.fn(),
    setDefaultLlmConfig: vi.fn(),
  },
}))

import { groupsApi } from '@/api/groups'
import { ApiError } from '@/api/client'
import { useGroupDetailStore } from '@/stores/groupDetail'

const mockGroup = {
  id: 1,
  name: 'Eng',
  description: 'Eng team',
  principal_id: 10,
  member_count: 3,
  agent_count: 2,
  llm_config_count: 1,
  tool_setting_count: 4,
  my_role: 'owner' as const,
}

const mockMember = {
  user_id: 42,
  email: 'a@example.com',
  name: 'Alice',
  role: 'member' as const,
  joined_at: '2026-01-01T00:00:00Z',
}

const mockAgent = { id: 5, name: 'Helper', principal_id: 10, created_at: '2026-01-02T00:00:00Z' }

const mockToolSetting = { tool_class: 'WeatherTool', settings: { api_key: 'k' } }

const mockLlmConfig = { id: 1, name: 'C', driver_class: 'D', is_default: true }

describe('useGroupDetailStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('fetchDetail populates the group and tracks loadedId', async () => {
    vi.mocked(groupsApi.get).mockResolvedValueOnce(mockGroup)
    const store = useGroupDetailStore()
    const group = await store.fetchDetail(1)
    expect(group).toBe(mockGroup)
    expect(store.group).toStrictEqual(mockGroup)
    expect(store.isLoadedFor(1)).toBe(true)
    expect(store.isLoadedFor(2)).toBe(false)
  })

  it('fetchDetail records errors and rethrows', async () => {
    vi.mocked(groupsApi.get).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.fetchDetail(1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('fetchMembers delegates to the API and caches the list', async () => {
    vi.mocked(groupsApi.listMembers).mockResolvedValueOnce([mockMember])
    const store = useGroupDetailStore()
    const members = await store.fetchMembers(1)
    expect(members).toEqual([mockMember])
    expect(store.members).toEqual([mockMember])
  })

  it('fetchAgents caches the agent list', async () => {
    vi.mocked(groupsApi.agents).mockResolvedValueOnce({ agents: [mockAgent] })
    const store = useGroupDetailStore()
    const agents = await store.fetchAgents(1)
    expect(agents).toEqual([mockAgent])
    expect(store.agents).toEqual([mockAgent])
  })

  it('fetchPreferences returns null on 404', async () => {
    vi.mocked(groupsApi.preferences).mockRejectedValueOnce(new ApiError('nf', 'NF', 404))
    const store = useGroupDetailStore()
    const prefs = await store.fetchPreferences(1)
    expect(prefs).toBeNull()
    expect(store.preferences).toBeNull()
  })

  it('fetchPreferences records non-404 errors', async () => {
    vi.mocked(groupsApi.preferences).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.fetchPreferences(1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('upsertPreferences persists the payload', async () => {
    vi.mocked(groupsApi.upsertPreferences).mockResolvedValueOnce({
      principal_id: 10,
      preferred_llm_config_id: 7,
    })
    const store = useGroupDetailStore()
    const prefs = await store.upsertPreferences(1, { preferred_llm_config_id: 7 })
    expect(prefs.preferred_llm_config_id).toBe(7)
    expect(store.preferences).toEqual({ principal_id: 10, preferred_llm_config_id: 7 })
  })

  it('upsertPreferences records errors and rethrows', async () => {
    vi.mocked(groupsApi.upsertPreferences).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.upsertPreferences(1, { preferred_llm_config_id: null })).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('fetchTools caches the list', async () => {
    vi.mocked(groupsApi.tools).mockResolvedValueOnce([mockToolSetting])
    const store = useGroupDetailStore()
    const tools = await store.fetchTools(1)
    expect(tools).toEqual([mockToolSetting])
    expect(store.toolSettings).toEqual([mockToolSetting])
  })

  it('upsertTool appends when the tool_class is new', async () => {
    vi.mocked(groupsApi.upsertTool).mockResolvedValueOnce({ tool_class: 'NewTool', settings: { k: 'v' } })
    const store = useGroupDetailStore()
    const updated = await store.upsertTool(1, 'NewTool', { k: 'v' })
    expect(updated.tool_class).toBe('NewTool')
    expect(store.toolSettings).toHaveLength(1)
  })

  it('upsertTool replaces an existing entry by tool_class', async () => {
    vi.mocked(groupsApi.upsertTool)
      .mockResolvedValueOnce(mockToolSetting)
      .mockResolvedValueOnce({ tool_class: 'WeatherTool', settings: { api_key: 'k2' } })
    const store = useGroupDetailStore()
    await store.upsertTool(1, 'WeatherTool', { api_key: 'k' })
    await store.upsertTool(1, 'WeatherTool', { api_key: 'k2' })
    expect(store.toolSettings).toHaveLength(1)
    expect(store.toolSettings[0].settings.api_key).toBe('k2')
  })

  it('deleteTool removes the entry from the cache', async () => {
    vi.mocked(groupsApi.tools).mockResolvedValueOnce([mockToolSetting])
    vi.mocked(groupsApi.deleteTool).mockResolvedValueOnce(undefined)
    const store = useGroupDetailStore()
    await store.fetchTools(1)
    await store.deleteTool(1, 'WeatherTool')
    expect(store.toolSettings).toHaveLength(0)
  })

  it('fetchLlmConfigs caches the list', async () => {
    vi.mocked(groupsApi.llmConfigs).mockResolvedValueOnce([mockLlmConfig])
    const store = useGroupDetailStore()
    const configs = await store.fetchLlmConfigs(1)
    expect(configs).toEqual([mockLlmConfig])
    expect(store.llmConfigs).toEqual([mockLlmConfig])
  })

  it('createLlmConfig appends to the cached list', async () => {
    vi.mocked(groupsApi.createLlmConfig).mockResolvedValueOnce(mockLlmConfig)
    const store = useGroupDetailStore()
    await store.createLlmConfig(1, { name: 'C', driver_class: 'D', settings: {} })
    expect(store.llmConfigs).toHaveLength(1)
  })

  it('updateLlmConfig replaces by id', async () => {
    vi.mocked(groupsApi.updateLlmConfig).mockResolvedValueOnce({ ...mockLlmConfig, name: 'Updated' })
    const store = useGroupDetailStore()
    store.llmConfigs = [mockLlmConfig, { id: 2, name: 'Other', driver_class: 'X' }]
    await store.updateLlmConfig(1, 1, { name: 'Updated' })
    expect(store.llmConfigs[0]).toMatchObject({ name: 'Updated' })
    expect(store.llmConfigs[1]).toMatchObject({ id: 2 })
  })

  it('deleteLlmConfig removes the entry by id', async () => {
    vi.mocked(groupsApi.deleteLlmConfig).mockResolvedValueOnce(undefined)
    const store = useGroupDetailStore()
    store.llmConfigs = [mockLlmConfig, { id: 2, name: 'Other', driver_class: 'X' }]
    await store.deleteLlmConfig(1, 1)
    expect(store.llmConfigs.map((c) => c.id)).toEqual([2])
  })

  it('setDefaultLlmConfig marks only the target as default', async () => {
    vi.mocked(groupsApi.setDefaultLlmConfig).mockResolvedValueOnce({ ...mockLlmConfig, is_default: true })
    const store = useGroupDetailStore()
    store.llmConfigs = [mockLlmConfig, { id: 2, name: 'Other', driver_class: 'X', is_default: true }]
    await store.setDefaultLlmConfig(1, 1)
    expect(store.llmConfigs.find((c) => Number(c.id) === 1)?.is_default).toBe(true)
    expect(store.llmConfigs.find((c) => Number(c.id) === 2)?.is_default).toBe(false)
  })

  it('updateGroup replaces the cached entry', async () => {
    vi.mocked(groupsApi.update).mockResolvedValueOnce({ ...mockGroup, name: 'Renamed' })
    const store = useGroupDetailStore()
    store.group = mockGroup
    const updated = await store.updateGroup(1, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(store.group?.name).toBe('Renamed')
  })

  it('updateGroup no-ops the cache when the id differs', async () => {
    vi.mocked(groupsApi.update).mockResolvedValueOnce({ ...mockGroup, id: 2, name: 'Other' })
    const store = useGroupDetailStore()
    store.group = mockGroup
    await store.updateGroup(2, { name: 'Other' })
    expect(store.group?.name).toBe('Eng')
  })

  it('deleteGroup records errors and rethrows', async () => {
    vi.mocked(groupsApi.remove).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.deleteGroup(1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('reset() clears every cached slice', () => {
    const store = useGroupDetailStore()
    store.group = mockGroup
    store.members = [mockMember]
    store.agents = [mockAgent]
    store.preferences = { principal_id: 10, preferred_llm_config_id: 7 }
    store.toolSettings = [mockToolSetting]
    store.llmConfigs = [mockLlmConfig]
    store.reset()
    expect(store.group).toBeNull()
    expect(store.members).toEqual([])
    expect(store.agents).toEqual([])
    expect(store.preferences).toBeNull()
    expect(store.toolSettings).toEqual([])
    expect(store.llmConfigs).toEqual([])
    expect(store.isLoadedFor(1)).toBe(false)
  })

  it('deleteGroup success path completes without throwing', async () => {
    vi.mocked(groupsApi.remove).mockResolvedValueOnce(undefined)
    const store = useGroupDetailStore()
    await expect(store.deleteGroup(1)).resolves.toBeUndefined()
  })

  it('upsertTool error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.upsertTool).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.upsertTool(1, 'NewTool', { k: 'v' })).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('deleteTool error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.deleteTool).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.deleteTool(1, 'WeatherTool')).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('createLlmConfig error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.createLlmConfig).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.createLlmConfig(1, { name: 'C', driver_class: 'D', settings: {} })).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('updateLlmConfig error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.updateLlmConfig).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.updateLlmConfig(1, 1, { name: 'X' })).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('deleteLlmConfig error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.deleteLlmConfig).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.deleteLlmConfig(1, 1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('setDefaultLlmConfig error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.setDefaultLlmConfig).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.setDefaultLlmConfig(1, 1)).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('updateGroup error path records store.error and rethrows', async () => {
    vi.mocked(groupsApi.update).mockRejectedValueOnce(new Error('boom'))
    const store = useGroupDetailStore()
    await expect(store.updateGroup(1, { name: 'X' })).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
  })

  it('fetchAgents tolerates a missing agents array in the wire response', async () => {
    vi.mocked(groupsApi.agents).mockResolvedValueOnce({} as never)
    const store = useGroupDetailStore()
    const agents = await store.fetchAgents(1)
    expect(agents).toEqual([])
    expect(store.agents).toEqual([])
  })
})
