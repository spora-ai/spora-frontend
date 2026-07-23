/**
 * useTaskUsageTotals — derive cache + token aggregates from a task's
 * assistant history.
 *
 * Two derived refs are returned:
 *
 * - `totals` — six-counter aggregate (see {@link UsageTotals}). Built by
 *   summing every assistant turn's `usage` row that is non-null.
 *   Provider and raw_usage are intentionally NOT aggregated.
 * - `perTurn` — the per-turn breakdown used to render the panel's
 *   expandable table. Each entry carries the original turn index
 *   (0-based against the `history` array) plus the precomputed
 *   `cacheHitRate` so the table never has to redo the math.
 *
 * Both refs are pure: given the same history they always return the same
 * shape, which keeps them cheap to test with plain inputs.
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { HistoryEntry } from '@/types/task'
import type { Usage, UsageTotals } from '@/types/usage'

/**
 * Compute the cache hit rate for a single turn.
 *
 * Returns a value in `[0, 1]` for any turn with billable input. The
 * denominator differs by provider because the two APIs report cached
 * tokens differently:
 *
 * - **Anthropic**: `input_tokens`, `cache_read_tokens`, and
 *   `cache_creation_tokens` are three independent counters. The total
 *   billable input for a turn is their sum. A naive
 *   `cache_read / input` division exceeds 1.0 the moment a turn is a
 *   full cache hit (every fresh token is a `cache_creation` token and
 *   `input_tokens` is 0). We sum all three instead.
 * - **OpenAI**: Chat Completions reports `cached_tokens` as a subset
 *   of `input_tokens` — they are NOT additive. The denominator is
 *   `input_tokens` alone, which by construction keeps the ratio in
 *   `[0, 1]`.
 *
 * Returns `null` when there is no billable input to divide by; the panel
 * renders that as an em-dash rather than a misleading `0%`.
 */
export function cacheHitRate(usage: Usage): number | null {
  if (usage.provider === 'anthropic') {
    const total =
      usage.input_tokens + usage.cache_read_tokens + usage.cache_creation_tokens
    if (total === 0) return null
    return usage.cache_read_tokens / total
  }
  // OpenAI: input_tokens already includes cached tokens. The "unknown"
  // provider falls through here because the OpenAI shape is the
  // conservative denominator that never overshoots 1.
  if (usage.input_tokens === 0) return null
  return usage.cached_tokens / usage.input_tokens
}

function emptyTotals(): UsageTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  }
}

function addUsage(into: UsageTotals, usage: Usage): void {
  into.input_tokens += usage.input_tokens
  into.output_tokens += usage.output_tokens
  into.reasoning_tokens += usage.reasoning_tokens
  into.cached_tokens += usage.cached_tokens
  into.cache_creation_tokens += usage.cache_creation_tokens
  into.cache_read_tokens += usage.cache_read_tokens
}

/** Shape returned by {@link useTaskUsageTotals}. */
export interface UseTaskUsageTotalsReturn {
  totals: ComputedRef<UsageTotals>
  perTurn: ComputedRef<Array<{ index: number; usage: Usage; cacheHitRate: number | null }>>
}

/**
 * Derive totals and per-turn breakdown from a task's history.
 *
 * Pass either a `Ref<HistoryEntry[] | null | undefined>` (typical — the
 * page reads from the task store) or a plain array. Tool turns and any
 * assistant turn without a `usage` row are skipped in both outputs.
 */
export function useTaskUsageTotals(
  history: Ref<HistoryEntry[] | null | undefined> | HistoryEntry[] | null | undefined,
): UseTaskUsageTotalsReturn {
  const source: Ref<HistoryEntry[] | null | undefined> = Array.isArray(history) || history === null || history === undefined
    ? computed(() => (Array.isArray(history) ? history : null))
    : (history as Ref<HistoryEntry[] | null | undefined>)

  const totals = computed<UsageTotals>(() => {
    const rows = source.value ?? []
    const acc = emptyTotals()
    rows.forEach((entry, idx) => {
      if (entry.role !== 'assistant' || !entry.usage) return
      void idx
      addUsage(acc, entry.usage)
    })
    return acc
  })

  const perTurn = computed(() => {
    const rows = source.value ?? []
    const out: Array<{ index: number; usage: Usage; cacheHitRate: number | null }> = []
    rows.forEach((entry, idx) => {
      if (entry.role !== 'assistant' || !entry.usage) return
      out.push({
        index: idx,
        usage: entry.usage,
        cacheHitRate: cacheHitRate(entry.usage),
      })
    })
    return out
  })

  return { totals, perTurn }
}
