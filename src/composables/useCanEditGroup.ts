import { computed, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * `true` when the caller may mutate the group (add / change-role /
 * remove members; edit group name / description; edit agents, tools,
 * preferences, llm-configs).
 *
 * The three sources of authority, in order:
 *  1. Global admin — always allowed (when logged in).
 *  2. Group role `owner` or `admin` — the group-level membership row.
 *  3. Everyone else — read-only.
 *
 * Use the group's `my_role` from the detail endpoint. On the list
 * endpoint it's undefined for callers who aren't members; the
 * computed returns `false` for them unless they're a global admin.
 *
 * Consumed by `GroupMembersPage` and the admin-panel
 * `GroupMembersModal`, which previously each carried a copy of the
 * same three-line computed. This composable is the single source of
 * truth — update here, not in the consumers.
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
