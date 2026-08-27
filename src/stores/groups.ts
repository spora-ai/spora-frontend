/**
 * Pinia store: groups list, member CRUD for the admin and per-group pages.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { groupsApi } from '@/api/groups'
import type { Group, GroupMember } from '@/types/principal'

// Pure pass-through — no closure state required. Lifted out of the
// store factory so it isn't recreated on every store call.
const fetchMembers = (groupId: number): Promise<GroupMember[]> =>
  groupsApi.listMembers(groupId)

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  /**
   * The id of the authenticated user the `groups` cache belongs to. The
   * router prefetches groups in `beforeEach` once per session; without
   * this fingerprint a non-admin signing in after an admin sees the
   * admin's cached list (a previous-user data leak). The router hook
   * calls `markStale()` on any user change so the next `fetchGroups()`
   * always re-issues the request under the new session.
   *
   * `null` = no user has been served yet (empty cache from boot).
   */
  const servedUserId = ref<number | null>(null)

  /**
   * Mark the cache as belonging to a different user (or no user). Clears
   * `groups`, `error`, and the `servedUserId` fingerprint. The next
   * `fetchGroups()` will issue a fresh request under the new session.
   *
   * Called from `src/router/index.ts:140-152` whenever `auth.user.id`
   * drifts from `servedUserId` — that's the bug-fix anchor: a non-admin
   * signing in after an admin no longer sees the admin's cached list.
   */
  function markStale(): void {
    groups.value = []
    error.value = null
    servedUserId.value = null
  }

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
    loading.value = true
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
      loading.value = false
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

  async function addMember(
    groupId: number,
    payload: { user_id: number } | { email: string },
    role: string,
  ): Promise<GroupMember> {
    saving.value = true
    error.value = null
    try {
      const member = await groupsApi.addMember(groupId, payload, role)
      const group = groups.value.find((g) => g.id === groupId)
      if (group) {
        group.member_count = (group.member_count ?? 0) + 1
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
      if (group?.member_count !== undefined) {
        group.member_count = Math.max(0, group.member_count - 1)
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
    servedUserId,
    fetchGroups,
    fetchGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    fetchMembers,
    addMember,
    markStale,
    updateMember,
    removeMember,
  }
})