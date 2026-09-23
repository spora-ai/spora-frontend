/**
 * Multi-word-aware two-letter initials for a user — used by the
 * AccountPage identity card and the `UserProfilePictureSection`
 * upload preview so the header badge and the picker preview agree
 * ("Max Mustermann" → "MM", not "Ma").
 *
 * Rules, in order:
 *   1. Trim the `name`. If empty, fall through.
 *   2. Split on whitespace; use the first letter of the first two
 *      non-empty parts. ("John Doe" → "JD", "  Jane  Q  Doe  " → "JQ".)
 *   3. If only one part remains, use the first two characters
 *      (single-character names stay single-character). ("Me" → "ME",
 *      "X" → "X".)
 *   4. If no name at all, fall through to the email.
 *   5. Fallback to the first two characters of `email`.
 *   6. Final fallback to `'?'`.
 *
 * Usage:
 *   const auth = useAuthStore()
 *   const initials = useInitials(() => auth.user)
 *   // → ComputedRef<string>, always upper-case
 */
import { computed, type ComputedRef, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import type { User } from '@/types/user'

export function useInitials(
  user: Ref<User | null> | MaybeRefOrGetter<User | null>,
): ComputedRef<string> {
  return computed<string>(() => {
    const u = toValue(user)
    const name = (u?.name ?? '').trim()
    if (name !== '') {
      const parts = name.split(/\s+/u).filter((p) => p !== '')
      if (parts.length >= 2) {
        return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).toUpperCase()
      }
      const first = parts[0] ?? ''
      if (first.length >= 2) return first.slice(0, 2).toUpperCase()
      return first.toUpperCase()
    }
    const email = (u?.email ?? '').trim()
    if (email !== '') return email.slice(0, 2).toUpperCase()
    return '?'
  })
}
