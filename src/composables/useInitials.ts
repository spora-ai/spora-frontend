/**
 * Multi-word-aware two-letter initials — used by the AccountPage
 * identity card and `UserProfilePictureSection` so the header badge
 * and the upload preview agree ("Max Mustermann" → "MM", not "Ma").
 *
 * Fallback chain: first letter of each of the first two whitespace-
 * separated name parts, then first 2 chars of the single part, then
 * first 2 chars of the email, then `'?'`. Always upper-case.
 *
 * Usage:
 *   const initials = useInitials(() => auth.user)
 *   // → ComputedRef<string>
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
