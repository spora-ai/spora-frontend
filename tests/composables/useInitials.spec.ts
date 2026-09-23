/**
 * useInitials — multi-word-aware two-letter initials used by the
 * AccountPage identity card and `UserProfilePictureSection`. Covers
 * the fallback chain (first letter of each of the first two name
 * parts → first 2 chars of single name → first 2 chars of email →
 * '?') so the helper doesn't regress when consumed by a future
 * shell context (e.g. without a Pinia + auth store).
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useInitials } from '@/composables/useInitials'

describe('useInitials', () => {
  it('returns the first letter of each of the first two name parts', () => {
    const u = ref({ name: 'John Doe', email: 'john@example.com' })
    expect(useInitials(u).value).toBe('JD')
  })

  it('handles extra whitespace and three-part names', () => {
    const u = ref({ name: '  Jane  Q  Doe  ', email: 'jane@example.com' })
    expect(useInitials(u).value).toBe('JQ')
  })

  it('uses the first 2 chars when the name has only one part', () => {
    expect(useInitials(ref({ name: 'Me', email: 'm@x.com' })).value).toBe('ME')
  })

  it('returns the single char when the name is one character', () => {
    expect(useInitials(ref({ name: 'X', email: 'x@x.com' })).value).toBe('X')
  })

  it('falls through to the first 2 chars of the email when the name is empty', () => {
    expect(useInitials(ref({ name: null, email: 'me@example.com' })).value).toBe('ME')
  })

  it('returns "?" when name and email are both missing', () => {
    expect(useInitials(ref({ name: null, email: '' })).value).toBe('?')
    expect(useInitials(ref(null)).value).toBe('?')
  })

  it('always upper-cases the result', () => {
    expect(useInitials(ref({ name: 'alice baker', email: 'a@x.com' })).value).toBe('AB')
  })
})
