/**
 * useTaskUsageTotals — pure derived state from a task's history.
 *
 * The headline numbers come from the server-supplied `TaskDetail.totals`
 * in production, but the composable still derives them from history as a
 * safety net / fallback. Both the formula and the per-turn table are
 * tested here so the panel can stay presentation-only.
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { cacheHitRate, useTaskUsageTotals } from '@/composables/useTaskUsageTotals'
import type { HistoryEntry } from '@/types/task'
import type { Usage } from '@/types/usage'

function anthropicTurn(over: Partial<Usage> = {}): Usage {
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

function openaiTurn(over: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 500,
    output_tokens: 80,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    provider: 'openai',
    ...over,
  }
}

function assistantEntry(usage: Usage | null, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sequence: 0,
    role: 'assistant',
    content: 'ok',
    reasoning: null,
    tool_call_id: null,
    tool_name: null,
    usage,
    ...overrides,
  }
}

describe('cacheHitRate', () => {
  it('returns null for Anthropic when there is no billable input', () => {
    expect(
      cacheHitRate(anthropicTurn({ input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 })),
    ).toBeNull()
  })

  it('stays in [0, 1] for Anthropic even when every token is a cache hit', () => {
    // 0 input + 100% cache_read + 0 cache_creation → 1.0
    const r = cacheHitRate(
      anthropicTurn({ input_tokens: 0, cache_read_tokens: 800, cache_creation_tokens: 0 }),
    )
    expect(r).not.toBeNull()
    expect(r!).toBe(1)
    expect(r!).toBeLessThanOrEqual(1)
    expect(r!).toBeGreaterThanOrEqual(0)
  })

  it('stays in [0, 1] for Anthropic when a turn is fully cache creation', () => {
    // 0 input + 0 cache_read + 100% cache_creation → 0
    const r = cacheHitRate(
      anthropicTurn({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 200 }),
    )
    expect(r).toBe(0)
  })

  it('uses the right denominator for Anthropic — exceeds 1 would be a bug', () => {
    // 100 input + 500 cache_read + 200 cache_creation → 500 / 800 = 0.625
    // A naive `cache_read / input` would yield 5.0, which is wrong.
    const r = cacheHitRate(
      anthropicTurn({ input_tokens: 100, cache_read_tokens: 500, cache_creation_tokens: 200 }),
    )
    expect(r).toBeCloseTo(0.625, 3)
    expect(r!).toBeLessThanOrEqual(1)
  })

  it('returns null for OpenAI when input_tokens is 0', () => {
    expect(cacheHitRate(openaiTurn({ input_tokens: 0, cached_tokens: 0 }))).toBeNull()
  })

  it('divides cached_tokens by input_tokens for OpenAI (cached is a subset)', () => {
    const r = cacheHitRate(openaiTurn({ input_tokens: 1000, cached_tokens: 250 }))
    expect(r).toBe(0.25)
  })

  it('returns null for unknown provider with empty input', () => {
    expect(cacheHitRate({ ...openaiTurn({ input_tokens: 0, cached_tokens: 0 }), provider: 'unknown' })).toBeNull()
  })

  it('falls back to the OpenAI formula for the unknown provider (conservative)', () => {
    const r = cacheHitRate({
      ...openaiTurn({ input_tokens: 100, cached_tokens: 40 }),
      provider: 'unknown',
    })
    expect(r).toBe(0.4)
  })

  // Regression for the headline cache hit rate in TaskUsagePanel:
  // input=1654, cache_read=1024, cache_creation=0 →
  // 1024 / (1654 + 1024 + 0) = 1024 / 2678 ≈ 0.3824 → 38.2%.
  // The naive `cached_tokens / input_tokens` division would yield 0
  // (OpenAI's formula on Anthropic data) — see Bug A in the PR.
  it('returns 38.2% for the headline aggregate on a typical Anthropic turn', () => {
    const r = cacheHitRate(
      anthropicTurn({
        input_tokens: 1654,
        output_tokens: 0,
        cache_read_tokens: 1024,
        cache_creation_tokens: 0,
      }),
    )
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(0.3824, 3)
  })
})

describe('useTaskUsageTotals — totals', () => {
  it('returns zero totals for an empty / null history', () => {
    const { totals, perTurn } = useTaskUsageTotals(null)
    expect(totals.value).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
    expect(perTurn.value).toEqual([])
  })

  it('skips user and tool turns', () => {
    const history: HistoryEntry[] = [
      { sequence: 0, role: 'user', content: 'hi', reasoning: null, tool_call_id: null, tool_name: null },
      { sequence: 1, role: 'tool', content: 'r', reasoning: null, tool_call_id: 'c1', tool_name: 't' },
    ]
    const { totals, perTurn } = useTaskUsageTotals(history)
    expect(totals.value).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
    expect(perTurn.value).toEqual([])
  })

  it('skips assistant turns without a usage row', () => {
    const history: HistoryEntry[] = [
      assistantEntry(null, { sequence: 0 }),
      assistantEntry(openaiTurn({ input_tokens: 10, output_tokens: 5 }), { sequence: 1 }),
    ]
    const { totals, perTurn } = useTaskUsageTotals(history)
    expect(totals.value.input_tokens).toBe(10)
    expect(totals.value.output_tokens).toBe(5)
    expect(perTurn.value).toHaveLength(1)
  })

  it('sums every counter across assistant turns', () => {
    const history: HistoryEntry[] = [
      assistantEntry(anthropicTurn({ input_tokens: 100, output_tokens: 50, reasoning_tokens: 200 }), { sequence: 0 }),
      assistantEntry(anthropicTurn({ input_tokens: 200, output_tokens: 80, reasoning_tokens: 400, cache_read_tokens: 150, cache_creation_tokens: 50 }), { sequence: 1 }),
    ]
    const { totals } = useTaskUsageTotals(history)
    expect(totals.value).toEqual({
      input_tokens: 300,
      output_tokens: 130,
      reasoning_tokens: 600,
      cached_tokens: 0,
      cache_creation_tokens: 50,
      cache_read_tokens: 150,
    })
  })
})

describe('useTaskUsageTotals — perTurn', () => {
  it('carries the original history index, the usage row, and the precomputed cacheHitRate', () => {
    const history: HistoryEntry[] = [
      { sequence: 0, role: 'user', content: 'hi', reasoning: null, tool_call_id: null, tool_name: null },
      assistantEntry(anthropicTurn({ input_tokens: 100, cache_read_tokens: 200, cache_creation_tokens: 50 }), { sequence: 1 }),
      assistantEntry(openaiTurn({ input_tokens: 500, cached_tokens: 100 }), { sequence: 2 }),
    ]
    const { perTurn } = useTaskUsageTotals(history)
    expect(perTurn.value).toHaveLength(2)
    expect(perTurn.value[0].index).toBe(1)
    expect(perTurn.value[0].usage.provider).toBe('anthropic')
    expect(perTurn.value[0].cacheHitRate).toBeCloseTo(200 / 350, 3)
    expect(perTurn.value[1].index).toBe(2)
    expect(perTurn.value[1].usage.provider).toBe('openai')
    expect(perTurn.value[1].cacheHitRate).toBe(0.2)
  })

  it('exposes cacheHitRate=null for an Anthropic turn with no billable input', () => {
    const history: HistoryEntry[] = [
      assistantEntry(
        anthropicTurn({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 }),
        { sequence: 0 },
      ),
    ]
    const { perTurn } = useTaskUsageTotals(history)
    expect(perTurn.value[0].cacheHitRate).toBeNull()
  })
})

describe('useTaskUsageTotals — reactive history', () => {
  it('recomputes when the input ref changes', () => {
    const source = ref<HistoryEntry[]>([])
    const { totals, perTurn } = useTaskUsageTotals(source)
    expect(totals.value.input_tokens).toBe(0)
    expect(perTurn.value).toHaveLength(0)

    source.value = [assistantEntry(openaiTurn({ input_tokens: 42 }), { sequence: 0 })]
    expect(totals.value.input_tokens).toBe(42)
    expect(perTurn.value).toHaveLength(1)
  })

  it('accepts a plain array input (non-reactive path)', () => {
    const history: HistoryEntry[] = [
      assistantEntry(openaiTurn({ input_tokens: 7 }), { sequence: 0 }),
    ]
    const { totals } = useTaskUsageTotals(history)
    expect(totals.value.input_tokens).toBe(7)
  })
})
