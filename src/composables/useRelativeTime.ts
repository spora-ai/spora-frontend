/**
 * Relative time, in the interface's language.
 *
 * The English branch renders the compact form (`5m ago`) that the dashboard
 * has always shipped and that its assertions pin; every other locale goes
 * through `Intl.RelativeTimeFormat` for its plural forms.
 *
 * This mirrors `spora-components/src/composables/useRelativeTime.ts`, which
 * owns the canonical implementation. Its locale-aware version —
 * `formatRelativeTime(iso, locale)` — is not in a published release yet, so
 * the frontend keeps its own copy until the package ships one.
 */

/**
 * `diff` is positive for the past and negative for the future, because it is
 * `now - then`. `Intl.RelativeTimeFormat` uses the opposite convention, so the
 * value is negated on the way in.
 */
function relative(locale: string, diff: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diff, unit)
}

const COMPACT_ENGLISH = /^en\b/i

/**
 * A timestamp as a relative string, in `locale`.
 *
 * `now` is a parameter rather than a call to `Date.now()` so a caller that
 * ticks on its own schedule can decide when the label is stale.
 *
 * The sub-minute bucket is "essentially now" on purpose: English says
 * `just now` rather than `30 seconds ago` to keep list rows quiet, so the
 * other locales get the same treatment instead of the literal value.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  locale: string,
  now: number = Date.now(),
): string {
  if (typeof iso !== 'string' || iso === '') return ''

  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso

  const diffSec = Math.round((now - then) / 1000)
  const abs = Math.abs(diffSec)

  if (abs < 60) {
    return COMPACT_ENGLISH.test(locale)
      ? diffSec >= 0 ? 'just now' : 'in a moment'
      : relative(locale, 0, 'second')
  }

  const minutes = Math.round(diffSec / 60)
  if (Math.abs(minutes) < 60) {
    return COMPACT_ENGLISH.test(locale) ? `${minutes}m ago` : relative(locale, minutes, 'minute')
  }

  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) {
    return COMPACT_ENGLISH.test(locale) ? `${hours}h ago` : relative(locale, hours, 'hour')
  }

  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) {
    return COMPACT_ENGLISH.test(locale) ? `${days}d ago` : relative(locale, days, 'day')
  }

  const weeks = Math.round(days / 7)
  if (Math.abs(weeks) < 5) {
    return COMPACT_ENGLISH.test(locale) ? `${weeks}w ago` : relative(locale, weeks, 'week')
  }

  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) {
    return COMPACT_ENGLISH.test(locale) ? `${months}mo ago` : relative(locale, months, 'month')
  }

  const years = Math.round(days / 365)
  return COMPACT_ENGLISH.test(locale) ? `${years}y ago` : relative(locale, years, 'year')
}
