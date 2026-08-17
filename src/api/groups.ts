import { api } from './client'
import type { Group, GroupMember } from '@/types/principal'

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
}