/**
 * useRelativeTime — the English compact form and the locale-aware form.
 *
 * A German locale goes through `Intl.RelativeTimeFormat` and never touches
 * the compact suffix path.
 */
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '@/composables/useRelativeTime'

const NOW = Date.parse('2026-10-20T12:00:00Z')

function isoFromNow(seconds: number): string {
  return new Date(NOW + seconds * 1000).toISOString()
}

describe('formatRelativeTime', () => {
  it('renders the compact English form for the past', () => {
    expect(formatRelativeTime(isoFromNow(-5 * 60), 'en', NOW)).toBe('5m ago')
    expect(formatRelativeTime(isoFromNow(-2 * 3600), 'en', NOW)).toBe('2h ago')
    expect(formatRelativeTime(isoFromNow(-3 * 86400), 'en', NOW)).toBe('3d ago')
  })

  it('counts months and years from the days, not from the weeks', () => {
    expect(formatRelativeTime(isoFromNow(-60 * 86400), 'en', NOW)).toBe('2mo ago')
    expect(formatRelativeTime(isoFromNow(-400 * 86400), 'en', NOW)).toBe('1y ago')
  })

  it('says "just now" for the present and "in a moment" for the future', () => {
    expect(formatRelativeTime(isoFromNow(-5), 'en', NOW)).toBe('just now')
    expect(formatRelativeTime(isoFromNow(30), 'en', NOW)).toBe('in a moment')
  })

  it('goes through Intl for every other locale', () => {
    // German has its own plural forms, so the compact English suffix
    // path must not be used.
    expect(formatRelativeTime(isoFromNow(-5 * 60), 'de', NOW)).toBe('vor 5 Minuten')
    expect(formatRelativeTime(isoFromNow(-2 * 3600), 'de', NOW)).toBe('vor 2 Stunden')
  })

  it('uses the locale-aware form for the sub-minute bucket too', () => {
    expect(formatRelativeTime(isoFromNow(-5), 'de', NOW)).toBe('jetzt')
  })

  it('returns an empty string for a missing or invalid timestamp', () => {
    expect(formatRelativeTime(null, 'en', NOW)).toBe('')
    expect(formatRelativeTime(undefined, 'en', NOW)).toBe('')
    expect(formatRelativeTime('', 'en', NOW)).toBe('')
    expect(formatRelativeTime('not-a-date', 'en', NOW)).toBe('not-a-date')
  })
})
