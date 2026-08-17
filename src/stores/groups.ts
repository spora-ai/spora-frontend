import { defineStore } from 'pinia'
import { ref } from 'vue'
import { groupsApi } from '@/api/groups'
import type { Group, GroupMember } from '@/types/principal'

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  async function fetchGroups(): Promise<Group[]> {
    loading.value = true
    error.value = null
    try {
      const list = await groupsApi.list()
      groups.value = list
      return list
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load groups.'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchGroup(id: number): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const group = await groupsApi.get(id)
      const idx = groups.value.findIndex((g) => g.id === id)
      if (idx !== -1) {
        groups.value[idx] = group
      } else {
        groups.value.push(group)
      }
      return group
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function createGroup(payload: { name: string; description?: string }): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const group = await groupsApi.create(payload)
      groups.value.unshift(group)
      return group
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function updateGroup(
    id: number,
    payload: { name?: string; description?: string },
  ): Promise<Group> {
    saving.value = true
    error.value = null
    try {
      const group = await groupsApi.update(id, payload)
      const idx = groups.value.findIndex((g) => g.id === id)
      if (idx !== -1) {
        groups.value[idx] = group
      }
      return group
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function deleteGroup(id: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await groupsApi.remove(id)
      groups.value = groups.value.filter((g) => g.id !== id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete group.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function fetchMembers(groupId: number): Promise<GroupMember[]> {
    return groupsApi.listMembers(groupId)
  }

  async function addMember(groupId: number, userId: number, role: string): Promise<GroupMember> {
    saving.value = true
    error.value = null
    try {
      const member = await groupsApi.addMember(groupId, userId, role)
      const group = groups.value.find((g) => g.id === groupId)
      if (group) {
        if (!group.members.some((m) => m.user_id === member.user_id)) {
          group.members = [...group.members, member]
        }
      }
      return member
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add member.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function updateMember(groupId: number, userId: number, role: string): Promise<GroupMember> {
    saving.value = true
    error.value = null
    try {
      const member = await groupsApi.updateMember(groupId, userId, role)
      const group = groups.value.find((g) => g.id === groupId)
      if (group) {
        const idx = group.members.findIndex((m) => m.user_id === userId)
        if (idx !== -1) {
          group.members[idx] = member
        }
      }
      return member
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update member.'
      throw e
    } finally {
      saving.value = false
    }
  }

  async function removeMember(groupId: number, userId: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await groupsApi.removeMember(groupId, userId)
      const group = groups.value.find((g) => g.id === groupId)
      if (group) {
        group.members = group.members.filter((m) => m.user_id !== userId)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove member.'
      throw e
    } finally {
      saving.value = false
    }
  }

  return {
    groups,
    loading,
    saving,
    error,
    fetchGroups,
    fetchGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    fetchMembers,
    addMember,
    updateMember,
    removeMember,
  }
})