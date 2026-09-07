/**
 * useCanEditGroup — single source of truth for the admin OR owner/admin
 * member-editing check. Consumed by GroupMembersPage and the admin-panel
 * GroupMembersModal.
 */
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'

const mockUser = ref<{ id: number; is_admin: boolean } | null>(null)

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() {
      return mockUser.value
    },
  }),
}))

import { useCanEditGroup } from '@/composables/useCanEditGroup'

function refGroup(role?: 'owner' | 'admin' | 'member' | null): Ref<{ my_role?: 'owner' | 'admin' | 'member' } | null> {
  return ref(role === null ? null : { my_role: role })
}

describe('useCanEditGroup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockUser.value = null
  })

  it('is false when no user is logged in', () => {
    mockUser.value = null
    const canEdit = useCanEditGroup(refGroup('owner'))
    expect(canEdit.value).toBe(false)
  })

  it('is true for global admin regardless of group role', () => {
    mockUser.value = { id: 1, is_admin: true }
    expect(useCanEditGroup(refGroup('owner')).value).toBe(true)
    expect(useCanEditGroup(refGroup('admin')).value).toBe(true)
    expect(useCanEditGroup(refGroup('member')).value).toBe(true)
    expect(useCanEditGroup(refGroup(null)).value).toBe(true)
  })

  it('is true for non-admin owner', () => {
    mockUser.value = { id: 1, is_admin: false }
    expect(useCanEditGroup(refGroup('owner')).value).toBe(true)
  })

  it('is true for non-admin admin-tier member', () => {
    mockUser.value = { id: 1, is_admin: false }
    expect(useCanEditGroup(refGroup('admin')).value).toBe(true)
  })

  it('is false for plain member', () => {
    mockUser.value = { id: 1, is_admin: false }
    expect(useCanEditGroup(refGroup('member')).value).toBe(false)
  })

  it('is false when group ref is null (e.g. list-endpoint payload)', () => {
    mockUser.value = { id: 1, is_admin: false }
    expect(useCanEditGroup(refGroup(null)).value).toBe(false)
  })

  it('is false when group has no my_role field (detail not loaded)', () => {
    mockUser.value = { id: 1, is_admin: false }
    expect(useCanEditGroup(ref({} as { my_role?: 'owner' | 'admin' | 'member' })).value).toBe(false)
  })

  it('reacts to group role changes (list → detail navigation)', () => {
    mockUser.value = { id: 1, is_admin: false }
    const groupRef = refGroup('member')
    const canEdit = useCanEditGroup(groupRef)
    expect(canEdit.value).toBe(false)
    groupRef.value = { my_role: 'owner' }
    expect(canEdit.value).toBe(true)
  })

  it('reacts to user state changes (admin grant mid-session)', () => {
    mockUser.value = { id: 1, is_admin: false }
    const canEdit = useCanEditGroup(refGroup('member'))
    expect(canEdit.value).toBe(false)
    mockUser.value = { id: 1, is_admin: true }
    expect(canEdit.value).toBe(true)
  })
})
