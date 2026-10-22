/**
 * Relative time, in the interface's language.
 *
 * The English branch renders the compact form (`5m ago`) that the dashboard
 * has always shipped and that its assertions pin; every other locale goes
 * through `Intl.RelativeTimeFormat` for its plural forms. Handing English to
 * `Intl` would return `5 minutes ago` and churn the assertions for no gain in
 * correctness.
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
 *
 * English hardcodes the word `ago` next to the signed number, so a future
 * timestamp renders as `-5m ago`.
 */
function relative(locale: string, diff: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diff, unit)
}

const COMPACT_ENGLISH = /^en\b/i

interface TimeBucket {
  unit: Intl.RelativeTimeFormatUnit
  /** The signed count of those units — positive for the past, like `diff`. */
  count: number
  /** The suffix the English branch appends; other locales use `unit`. */
  compactSuffix: string
}

/**
 * The thresholds are on the rounded count rather than on the raw diff, so
 * 59.5 minutes reads as an hour and not as 60 minutes.
 *
 * Months and years are counted from the days, not from the weeks: the week
 * bucket ends at five weeks, and a year is not twelve weeks.
 */
function bucketFor(diffSec: number): TimeBucket {
  const minutes = Math.round(diffSec / 60)
  if (Math.abs(minutes) < 60) return { unit: 'minute', count: minutes, compactSuffix: 'm' }

  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return { unit: 'hour', count: hours, compactSuffix: 'h' }

  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return { unit: 'day', count: days, compactSuffix: 'd' }

  const weeks = Math.round(days / 7)
  if (Math.abs(weeks) < 5) return { unit: 'week', count: weeks, compactSuffix: 'w' }

  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return { unit: 'month', count: months, compactSuffix: 'mo' }

  const years = Math.round(days / 365)
  return { unit: 'year', count: years, compactSuffix: 'y' }
}

/**
 * "Essentially now" on purpose: English says `just now` rather than
 * `30 seconds ago` to keep list rows quiet, so the other locales get the same
 * treatment instead of the literal value.
 */
function essentiallyNow(locale: string, diffSec: number): string {
  if (!COMPACT_ENGLISH.test(locale)) return relative(locale, 0, 'second')
  if (diffSec >= 0) return 'just now'
  return 'in a moment'
}

/**
 * A timestamp as a relative string, in `locale`.
 *
 * `now` is a parameter rather than a call to `Date.now()` so a caller that
 * ticks on its own schedule can decide when the label is stale.
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
  if (Math.abs(diffSec) < 60) return essentiallyNow(locale, diffSec)

  const bucket = bucketFor(diffSec)
  if (COMPACT_ENGLISH.test(locale)) return `${bucket.count}${bucket.compactSuffix} ago`
  return relative(locale, bucket.count, bucket.unit)
}
