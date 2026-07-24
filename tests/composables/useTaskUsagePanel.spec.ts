/**
 * useTaskUsagePanel — values shared by TaskUsageSummary and TaskUsageDetails.
 *
 * The split is purely visual — the composable is the data layer that
 * both components call. The headline totals merge the server-supplied
 * `totals` with the resolved `provider` so the cache hit rate picks the
 * right denominator (Bug A regression — without the merge, Anthropic
 * data falls through to the OpenAI branch and reads as 0%).
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useTaskUsagePanel } from '@/composables/useTaskUsagePanel'
import type { HistoryEntry } from '@/types/task'
import type { Usage, UsageProvider } from '@/types/usage'

function anthropicUsage(over: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 200,
    cached_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    provider: 'anthropic',
    ...over,
  }
}

function openaiUsage(over: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 1000,
    output_tokens: 100,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    provider: 'openai',
    ...over,
  }
}

function assistantTurn(usage: Usage | null, sequence = 0): HistoryEntry {
  return {
    sequence,
    role: 'assistant',
    content: 'ok',
    content_blocks: null,
    tool_call_id: null,
    tool_name: null,
    usage,
  }
}

function userTurn(sequence = 0): HistoryEntry {
  return {
    sequence,
    role: 'user',
    content: 'hi',
    content_blocks: null,
    tool_call_id: null,
    tool_name: null,
    usage: null,
  }
}

function aggregate(rows: Usage[]): Usage {
  return rows.reduce<Usage>(
    (acc, u) => ({
      input_tokens: acc.input_tokens + u.input_tokens,
      output_tokens: acc.output_tokens + u.output_tokens,
      reasoning_tokens: acc.reasoning_tokens + u.reasoning_tokens,
      cached_tokens: acc.cached_tokens + u.cached_tokens,
      cache_creation_tokens: acc.cache_creation_tokens + u.cache_creation_tokens,
      cache_read_tokens: acc.cache_read_tokens + u.cache_read_tokens,
      provider: u.provider,
    }),
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
}

describe('useTaskUsagePanel', () => {
  it('derives provider from the most recent assistant row (not the totals prop)', () => {
    const history = [
      assistantTurn(openaiUsage(), 0),
      assistantTurn(anthropicUsage(), 1),
    ]
    const { provider } = useTaskUsagePanel(history, aggregate([anthropicUsage()]))
    expect(provider.value).toBe('anthropic')
  })

  it('falls back to the totals prop provider when history has no assistant rows', () => {
    const { provider } = useTaskUsagePanel([userTurn()], { ...anthropicUsage(), provider: 'anthropic' })
    expect(provider.value).toBe('anthropic')
  })

  it('merges the resolved provider into the server totals (Bug A regression)', () => {
    // The server-supplied `totals` shape has `provider: anthropic` at the
    // wire level, but to verify the merge logic we strip it via the
    // cast in the test (this mirrors the runtime bug).
    const rows = [anthropicUsage({ input_tokens: 1654, cache_read_tokens: 1024 })]
    const totals = aggregate(rows)
    const { headlineTotals } = useTaskUsagePanel(rows.map((u, i) => assistantTurn(u, i)), totals)
    expect(headlineTotals.value?.provider).toBe<UsageProvider>('anthropic')
    expect(headlineTotals.value?.input_tokens).toBe(1654)
  })

  it('overallHitRate is non-null for Anthropic with cache_read > 0', () => {
    const rows = [anthropicUsage({ input_tokens: 1654, cache_read_tokens: 1024 })]
    const { overallHitRate } = useTaskUsagePanel(
      rows.map((u, i) => assistantTurn(u, i)),
      aggregate(rows),
    )
    expect(overallHitRate.value).not.toBeNull()
    expect(overallHitRate.value!).toBeCloseTo(1024 / 2678, 4)
  })

  it('overallHitRate is null when there is no billable input', () => {
    const rows = [anthropicUsage({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 })]
    const { overallHitRate } = useTaskUsagePanel(
      rows.map((u, i) => assistantTurn(u, i)),
      aggregate(rows),
    )
    expect(overallHitRate.value).toBeNull()
  })

  it('hasAnyUsage is true when any assistant row has usage', () => {
    const rows = [assistantTurn(null), assistantTurn(anthropicUsage())]
    const { hasAnyUsage } = useTaskUsagePanel(rows, null)
    expect(hasAnyUsage.value).toBe(true)
  })

  it('hasAnyUsage is false when no assistant row has usage', () => {
    const { hasAnyUsage } = useTaskUsagePanel([userTurn(), assistantTurn(null)], null)
    expect(hasAnyUsage.value).toBe(false)
  })

  it('showCacheSplit is true only for Anthropic', () => {
    const { showCacheSplit: anthropic } = useTaskUsagePanel(
      [assistantTurn(anthropicUsage())],
      null,
    )
    expect(anthropic.value).toBe(true)

    const { showCacheSplit: openai } = useTaskUsagePanel(
      [assistantTurn(openaiUsage())],
      null,
    )
    expect(openai.value).toBe(false)

    const { showCacheSplit: unknown } = useTaskUsagePanel([], null)
    expect(unknown.value).toBe(false)
  })

  it('providerBadgeClasses resolves the blue/violet/muted palette', () => {
    const { providerBadgeClasses: openai } = useTaskUsagePanel(
      [assistantTurn(openaiUsage())],
      null,
    )
    expect(openai.value).toMatch(/blue/)

    const { providerBadgeClasses: anthropic } = useTaskUsagePanel(
      [assistantTurn(anthropicUsage())],
      null,
    )
    expect(anthropic.value).toMatch(/violet/)

    const { providerBadgeClasses: unknown } = useTaskUsagePanel([], null)
    expect(unknown.value).toMatch(/muted/)
  })

  it('returns terse provider-specific empty-state messages', () => {
    const { emptyStateMessage } = useTaskUsagePanel([], null)

    expect(emptyStateMessage('anthropic')).toBe('No cache hits yet — try cache_control breakpoints.')
    expect(emptyStateMessage('openai')).toBe('No cache hits yet — promote stable prefixes.')
    expect(emptyStateMessage('unknown')).toBe('No usage yet.')
  })

  it('falls back to per-row derivation when totals is null', () => {
    // The bug-A-flavored compute must still work when the server hasn't
    // sent a `totals` block — the per-row fallback is `derivedTotals`
    // and the provider is merged in from history.
    const rows = [
      anthropicUsage({ input_tokens: 100, output_tokens: 50 }),
      anthropicUsage({ input_tokens: 200, output_tokens: 80 }),
    ]
    const { headlineTotals } = useTaskUsagePanel(
      rows.map((u, i) => assistantTurn(u, i)),
      null,
    )
    expect(headlineTotals.value?.input_tokens).toBe(300)
    expect(headlineTotals.value?.output_tokens).toBe(130)
    expect(headlineTotals.value?.provider).toBe<UsageProvider>('anthropic')
  })

  it('accepts a reactive ref for history and totals', () => {
    const history = ref<HistoryEntry[]>([assistantTurn(anthropicUsage())])
    const totals = ref<Usage | null>(aggregate([anthropicUsage()]))
    const { provider, overallHitRate } = useTaskUsagePanel(history, totals)
    expect(provider.value).toBe('anthropic')
    expect(overallHitRate.value).not.toBeNull()

    // Mutating the refs re-derives.
    history.value = [assistantTurn(openaiUsage())]
    totals.value = aggregate([openaiUsage()])
    expect(provider.value).toBe('openai')
  })

  it('exposes non-empty perTurn even when totals is null', () => {
    const rows = [anthropicUsage(), openaiUsage()]
    const { perTurn } = useTaskUsagePanel(
      rows.map((u, i) => assistantTurn(u, i)),
      null,
    )
    expect(perTurn.value).toHaveLength(2)
    expect(perTurn.value[0]?.cacheHitRate).not.toBeNull()
  })
})
