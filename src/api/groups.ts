import { api } from './client'
import type { Group, GroupMember } from '@/types/principal'

export interface GroupPreferences {
  principal_id: number
  preferred_llm_config_id: number | null
  updated_at?: string
}

export interface ToolSetting {
    tool_class: string
    settings: Record<string, string>
}

export interface GroupLlmConfigPayload {
    name: string
    driver_class: string
    settings: Record<string, string>
    context_window?: number
    max_tokens_output?: number
    is_default?: boolean
}

export interface GroupLlmConfigUpdatePayload {
    name?: string
    settings?: Record<string, string>
    context_window?: number
    max_tokens_output?: number
}

export const groupsApi = {
  list: (): Promise<Group[]> => api.get<{ groups: Group[] }>('/groups').then((r) => r.groups),

  get: (id: number): Promise<Group> => api.get<{ group: Group }>(`/groups/${id}`).then((r) => r.group),

  create: (payload: { name: string; description?: string }): Promise<Group> =>
    api.post<{ group: Group }>('/groups', payload).then((r) => r.group),

  update: (id: number, payload: { name?: string; description?: string }): Promise<Group> =>
    api.patch<{ group: Group }>(`/groups/${id}`, payload).then((r) => r.group),

  remove: (id: number): Promise<void> => api.delete(`/groups/${id}`),

  listMembers: (groupId: number): Promise<GroupMember[]> =>
    api.get<{ members: GroupMember[] }>(`/groups/${groupId}/members`).then((r) => r.members),

  addMember: (groupId: number, userId: number, role: string): Promise<GroupMember> =>
    api.post<{ member: GroupMember }>(`/groups/${groupId}/members`, { user_id: userId, role }).then((r) => r.member),

  updateMember: (groupId: number, userId: number, role: string): Promise<GroupMember> =>
    api.patch<{ member: GroupMember }>(`/groups/${groupId}/members/${userId}`, { role }).then((r) => r.member),

  removeMember: (groupId: number, userId: number): Promise<void> =>
    api.delete(`/groups/${groupId}/members/${userId}`),

  agents: (groupId: number): Promise<{ agents: Array<Record<string, unknown>>; total?: number }> =>
    api.get<{ agents: Array<Record<string, unknown>>; total?: number }>(`/groups/${groupId}/agents`),

  preferences: (groupId: number): Promise<GroupPreferences> =>
    api.get<{ preference: GroupPreferences }>(`/groups/${groupId}/preferences`).then((r) => r.preference),

  upsertPreferences: (groupId: number, payload: { preferred_llm_config_id: number | null }): Promise<GroupPreferences> =>
    api.put<{ preference: GroupPreferences }>(`/groups/${groupId}/preferences`, payload).then((r) => r.preference),

  tools: (groupId: number): Promise<ToolSetting[]> =>
    api.get<{ tool_settings: ToolSetting[] }>(`/groups/${groupId}/tools`).then((r) => r.tool_settings ?? []),

  upsertTool: (groupId: number, toolClass: string, settings: Record<string, string>): Promise<ToolSetting> =>
    api.post<{ tool_setting: ToolSetting }>(`/groups/${groupId}/tools/${encodeURIComponent(toolClass)}`, { settings }).then((r) => r.tool_setting),

  deleteTool: (groupId: number, toolClass: string): Promise<void> =>
    api.delete(`/groups/${groupId}/tools/${encodeURIComponent(toolClass)}`),

  llmConfigs: (groupId: number): Promise<Array<Record<string, unknown>>> =>
    api.get<{ configs: Array<Record<string, unknown>> }>(`/groups/${groupId}/llm-configs`).then((r) => r.configs ?? []),

  createLlmConfig: (groupId: number, payload: GroupLlmConfigPayload): Promise<Record<string, unknown>> =>
    api.post<{ config: Record<string, unknown> }>(`/groups/${groupId}/llm-configs`, payload).then((r) => r.config),

  updateLlmConfig: (groupId: number, configId: number, payload: GroupLlmConfigUpdatePayload): Promise<Record<string, unknown>> =>
    api.patch<{ config: Record<string, unknown> }>(`/groups/${groupId}/llm-configs/${configId}`, payload).then((r) => r.config),

  deleteLlmConfig: (groupId: number, configId: number): Promise<void> =>
    api.delete(`/groups/${groupId}/llm-configs/${configId}`),

  setDefaultLlmConfig: (groupId: number, configId: number): Promise<Record<string, unknown>> =>
    api.post<{ config: Record<string, unknown> }>(`/groups/${groupId}/llm-configs/${configId}/set-default`).then((r) => r.config),
}
