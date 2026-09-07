import { computed, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * `true` when the caller may mutate the group — global admin, OR a
 * group `owner`/`admin` member. Reads `my_role` from the detail
 * endpoint (the list endpoint omits it for non-members, so they
 * resolve to `false` here).
 *
 * Single source of truth — `GroupMembersPage` and `GroupMembersModal`
 * both consume this; update here, not in the consumers.
 */
export function useCanEditGroup(
  groupRef: Ref<{ my_role?: 'owner' | 'admin' | 'member' } | null>,
) {
  const auth = useAuthStore()
  return computed<boolean>(() => {
    if (auth.user === null) return false
    if (auth.user.is_admin) return true
    const role = groupRef.value?.my_role
    return role === 'owner' || role === 'admin'
  })
}
