/**
 * useTaskUsagePanel — derive every value the TaskUsageSummary and
 * TaskUsageDetails components need to render the split LLM usage UI.
 *
 * The split is purely visual: the chat header renders the compact
 * summary (Input/Output + Cache hit + Show details toggle) on the
 * right, and the details panel (provider tag + per-turn table) renders
 * as a sibling below the header. They share a parent-owned
 * `detailsOpen` ref via v-model so the toggle in the summary flips
 * the details' visibility.
 *
 * Inputs:
 * - `history` — either a `Ref<HistoryEntry[]>` or a plain array. The
 *   composable internally coerces to a ref so the computeds stay
 *   reactive either way.
 * - `totals` — the server-supplied aggregate. When non-null we use it
 *   as the primary source for the headline numbers; when null we fall
 *   back to deriving them from history.
 *
 * The composable also owns the provider badge palette (blue for
 * OpenAI, violet for Anthropic, muted for unknown) and the badge
 * tone palette (green / amber / red for cache hit rate ranges). Both
 * are computed off the resolved `provider` ref so the summary and
 * details stay in lock-step.
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import { useTaskUsageTotals, cacheHitRate } from '@/composables/useTaskUsageTotals'
import type { HistoryEntry } from '@/types/task'
import type { Usage, UsageProvider } from '@/types/usage'

interface BadgeTone {
  label: string
  classes: string
}

/** Shape returned by {@link useTaskUsagePanel}. */
export interface UseTaskUsagePanelReturn {
  /** Numeric totals used in the compact summary (Input / Output). */
  headlineTotals: ComputedRef<Usage | null>
  /** Resolved provider — the most recent assistant row's provider. */
  provider: ComputedRef<UsageProvider>
  /** Aggregate cache hit rate, or null when there is no billable input. */
  overallHitRate: ComputedRef<number | null>
  /** True when at least one assistant row carries a usage object. */
  hasAnyUsage: ComputedRef<boolean>
  /** Per-turn breakdown used by the details table. */
  perTurn: ComputedRef<Array<{ index: number; usage: Usage; cacheHitRate: number | null }>>
  /** Anthropic-only — gates the Cache read / Cache create columns. */
  showCacheSplit: ComputedRef<boolean>
  /** Tailwind classes for the provider tag in the details panel. */
  providerBadgeClasses: ComputedRef<string>
  /** Locale thousands-separated token count for the panel tables. */
  formatTokenCount: (n: number) => string
  /** Badge tone (label + classes) for a cache hit rate. */
  hitRateTone: (rate: number | null) => BadgeTone
  /** Provider-specific empty-state hint. */
  emptyStateMessage: (p: UsageProvider) => string
  /** Human-readable provider label. */
  providerLabel: (p: UsageProvider) => string
}

/**
 * Resolve a possibly-ref input into a `Ref<Usage | null | undefined>`.
 * Accepts a plain `Usage | null | undefined`, a `Ref<Usage | null | undefined>`,
 * or `null` / `undefined`. The returned ref's value is `null` when the
 * caller passed nothing usable.
 */
function resolveTotalsSource(
  totals: Ref<Usage | null | undefined> | Usage | null | undefined,
): Ref<Usage | null | undefined> {
  if (totals === null || totals === undefined) {
    return computed(() => null)
  }
  // A plain Usage object has a numeric `input_tokens` field. A ref
  // never does at the top level — its `.value` does.
  if (typeof (totals as Usage).input_tokens === 'number') {
    return computed(() => totals as Usage)
  }
  const refVal = totals as Ref<Usage | null | undefined>
  return computed(() => refVal.value ?? null)
}

/**
 * Derive the values both the summary and details components need.
 * Pass either a `Ref<HistoryEntry[]>` or a plain array for `history`;
 * the same applies to `totals`.
 */
export function useTaskUsagePanel(
  history: Ref<HistoryEntry[] | null | undefined> | HistoryEntry[] | null | undefined,
  totals: Ref<Usage | null | undefined> | Usage | null | undefined,
): UseTaskUsagePanelReturn {
  const historySource: Ref<HistoryEntry[] | null | undefined> = Array.isArray(history) || history === null || history === undefined
    ? computed(() => (Array.isArray(history) ? history : null))
    : (history as Ref<HistoryEntry[] | null | undefined>)

  const totalsSource = resolveTotalsSource(totals)

  // `useTaskUsageTotals` already handles the per-turn aggregation; we
  // only need `perTurn` for the details table. The headline numbers
  // come from the server-aggregated `totals` input with a per-row
  // fallback that mirrors the existing TaskUsagePanel logic.
  const { perTurn } = useTaskUsageTotals(historySource)

  const totalsProvider = computed<UsageProvider>(() => totalsSource.value?.provider ?? 'unknown')

  const provider = computed<UsageProvider>(() => {
    const rows = historySource.value ?? []
    let lastProvider: UsageProvider | undefined
    for (let i = rows.length - 1; i >= 0; i--) {
      const h = rows[i]
      if (h && h.role === 'assistant' && h.usage) {
        lastProvider = h.usage.provider
        break
      }
    }
    return lastProvider ?? totalsProvider.value
  })

  // Per-row aggregate that mirrors the formula in the totals composable
  // but produces a `Usage` (with provider) so the headline numbers can
  // feed straight into `cacheHitRate()`. Used when the server hasn't
  // supplied a `totals` block.
  const derivedTotals = computed<Usage>(() => {
    const rows = historySource.value ?? []
    return rows.reduce<Usage>(
      (acc, entry) => {
        if (entry.role !== 'assistant' || !entry.usage) return acc
        const u = entry.usage
        acc.input_tokens += u.input_tokens
        acc.output_tokens += u.output_tokens
        acc.reasoning_tokens += u.reasoning_tokens
        acc.cached_tokens += u.cached_tokens
        acc.cache_creation_tokens += u.cache_creation_tokens
        acc.cache_read_tokens += u.cache_read_tokens
        return acc
      },
      {
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        provider: 'unknown',
      },
    )
  })

  // `headlineTotals` merges the server-supplied `totals` (or the
  // per-row fallback) with the resolved `provider` so the cache hit
  // rate picks the right denominator. Without the merge the server
  // totals have a possibly-undefined `provider` and the headline
  // cache hit silently drops to 0% for Anthropic data — see Bug A.
  const headlineTotals = computed<Usage | null>(() => {
    const resolved = provider.value
    if (totalsSource.value) {
      return resolved === 'unknown' ? totalsSource.value : { ...totalsSource.value, provider: resolved }
    }
    return resolved !== 'unknown'
      ? { ...derivedTotals.value, provider: resolved }
      : derivedTotals.value
  })

  const overallHitRate = computed<number | null>(() => {
    if (!headlineTotals.value) return null
    return cacheHitRate(headlineTotals.value)
  })

  const hasAnyUsage = computed(() => perTurn.value.length > 0)

  // Cache split columns are Anthropic-only. OpenAI does not surface
  // `cache_read_tokens` / `cache_creation_tokens` — the Chat
  // Completions API only reports `cached_tokens`, already covered by
  // the Cache hit % — so showing those columns as 0s is misleading.
  const showCacheSplit = computed(() => provider.value === 'anthropic')

  const providerBadgeClasses = computed(() => {
    if (provider.value === 'openai') {
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    }
    if (provider.value === 'anthropic') {
      return 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
    }
    return 'bg-muted text-muted-foreground'
  })

  function formatTokenCount(n: number): string {
    // Locale thousands separator so 1,234,567 reads at a glance.
    return n.toLocaleString('en-US')
  }

  function hitRateLabel(rate: number | null): string {
    if (rate === null) return '—'
    return `${(rate * 100).toFixed(1)}%`
  }

  function hitRateTone(rate: number | null): BadgeTone {
    if (rate === null) {
      return { label: '—', classes: 'bg-muted text-muted-foreground' }
    }
    if (rate >= 0.5) {
      return { label: hitRateLabel(rate), classes: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' }
    }
    if (rate >= 0.2) {
      return { label: hitRateLabel(rate), classes: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' }
    }
    return { label: hitRateLabel(rate), classes: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }
  }

  function emptyStateMessage(p: UsageProvider): string {
    if (p === 'anthropic') {
      return 'No cache hits yet — consider adding cache_control breakpoints.'
    }
    if (p === 'openai') {
      return 'OpenAI auto-caches 1024+ token prefixes — promote stable system prompts.'
    }
    return 'No cache hits yet — usage will appear here once the LLM driver reports it.'
  }

  function providerLabel(p: UsageProvider): string {
    if (p === 'anthropic') return 'Anthropic'
    if (p === 'openai') return 'OpenAI'
    return 'Unknown provider'
  }

  return {
    headlineTotals,
    provider,
    overallHitRate,
    hasAnyUsage,
    perTurn,
    showCacheSplit,
    providerBadgeClasses,
    formatTokenCount,
    hitRateTone,
    emptyStateMessage,
    providerLabel,
  }
}
