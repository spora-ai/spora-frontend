/**
 * useInitials — multi-word-aware two-letter initials.
 *
 * The implementation moved to `@spora-ai/components`; `@/composables/
 * useInitials` is now a re-export, so this suite pins the contract the
 * host actually depends on. The signature narrowed from a `User` object
 * to a raw name string and the terminal fallback changed from the
 * user's email to `'?'` — callers that want an email fallback resolve
 * name-or-email before calling (see `AccountPage.vue`,
 * `UserProfilePictureSection.vue`).
 *
 * Kept deliberately: the helper is on the host's import path for future
 * shell contexts, and it is the cheapest place to catch a behavioural
 * drift in the package's fallback chain.
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useInitials } from '@/composables/useInitials'

describe('useInitials', () => {
  it('returns the first letter of each of the first two name parts', () => {
    expect(useInitials(ref('John Doe')).value).toBe('JD')
  })

  it('handles extra whitespace and three-part names', () => {
    expect(useInitials(ref('  Jane  Q  Doe  ')).value).toBe('JQ')
  })

  it('uses the first 2 chars when the name has only one part', () => {
    expect(useInitials(ref('Me')).value).toBe('ME')
  })

  it('returns the single char when the name is one character', () => {
    expect(useInitials(ref('X')).value).toBe('X')
  })

  it('returns "?" for empty, whitespace-only and nullish input', () => {
    expect(useInitials(ref('')).value).toBe('?')
    expect(useInitials(ref('   ')).value).toBe('?')
    expect(useInitials(ref(null)).value).toBe('?')
    expect(useInitials(ref(undefined)).value).toBe('?')
  })

  // The email fallback is no longer the helper's job: an email string
  // fed in as the "name" is just sliced like any other input. The
  // call sites that relied on it resolve name-or-email first.
  it('slices an email passed in as the name, and no longer reads one itself', () => {
    expect(useInitials(ref('me@example.com')).value).toBe('ME')
  })

  it('always upper-cases the result', () => {
    expect(useInitials(ref('alice baker')).value).toBe('AB')
    expect(useInitials(ref('zed')).value).toBe('ZE')
  })

  it('tracks a getter so the computed re-evaluates on change', () => {
    const name = ref('Ada Lovelace')
    const initials = useInitials(() => name.value)
    expect(initials.value).toBe('AL')
    name.value = 'Grace Hopper'
    expect(initials.value).toBe('GH')
  })
})
