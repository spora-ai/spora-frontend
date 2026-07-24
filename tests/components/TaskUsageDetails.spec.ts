/**
 * TaskUsageDetails — provider tag + per-turn table for the chat details.
 *
 * The panel is a sibling of the chat header and is gated by a
 * parent-owned `detailsOpen` boolean. When closed it renders nothing;
 * when open it shows the Provider tag, the per-turn breakdown, and the
 * empty-state copy when there's no usage.
 *
 * The Cache read / Cache create columns are Anthropic-only — OpenAI's
 * Chat Completions API never reports those counters, so showing them as
 * 0s would be misleading.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TaskUsageDetails from '@/components/TaskUsageDetails.vue'
import type { HistoryEntry } from '@/types/task'
import type { Usage } from '@/types/usage'

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

function assistantTurn(usage: Usage, sequence: number): HistoryEntry {
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

function mountDetails(props: {
  history: HistoryEntry[]
  totals: Usage | null
  detailsOpen: boolean
  provider?: 'openai' | 'anthropic' | 'unknown' | null
}) {
  return mount(TaskUsageDetails, {
    props: {
      history: props.history,
      totals: props.totals,
      detailsOpen: props.detailsOpen,
      provider: props.provider ?? null,
    },
  })
}

describe('TaskUsageDetails', () => {
  it('renders nothing when detailsOpen is false', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: false,
    })
    expect(wrapper.find('[data-testid="usage-details"]').exists()).toBe(false)
  })

  it('renders the PROVIDER label and provider tag when detailsOpen is true', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    const details = wrapper.find('[data-testid="usage-details"]')
    expect(details.exists()).toBe(true)
    expect(details.text()).toContain('Provider')
    expect(details.find('.uppercase').text()).toBe('Provider')
    const tag = details.find('[data-testid="usage-provider"]')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe('Anthropic')
    expect(tag.classes().join(' ')).toMatch(/violet/)
  })

  it('renders the Cache read and Cache create columns when provider is Anthropic', () => {
    const rows = [
      anthropicUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 60,
        cache_creation_tokens: 20,
      }),
    ]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    expect(wrapper.text()).toContain('Cache read')
    expect(wrapper.text()).toContain('Cache create')
    expect(wrapper.text()).toContain('60')
    expect(wrapper.text()).toContain('20')
  })

  it('hides the Cache read and Cache create columns when provider is OpenAI', () => {
    const rows = [openaiUsage({ input_tokens: 1000, output_tokens: 100, cached_tokens: 200 })]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    expect(wrapper.text()).not.toContain('Cache read')
    expect(wrapper.text()).not.toContain('Cache create')
  })

  it('per-turn Hit rate badges use the cacheHitRate formula', () => {
    const rows = [
      anthropicUsage({
        input_tokens: 0,
        cache_read_tokens: 100,
        cache_creation_tokens: 0,
      }),
    ]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    const table = wrapper.find('[data-testid="usage-per-turn"]')
    expect(table.exists()).toBe(true)
    const row = wrapper.find('[data-testid="usage-row-0"]')
    expect(row.exists()).toBe(true)
    // 100% cache_read → 100.0%
    expect(row.text()).toContain('100.0%')
  })

  it('shows the Reasoning column when any row has reasoning_tokens > 0', () => {
    const rows = [
      anthropicUsage({ input_tokens: 100, output_tokens: 50, reasoning_tokens: 0 }),
      anthropicUsage({ input_tokens: 100, output_tokens: 50, reasoning_tokens: 200 }),
    ]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    expect(wrapper.text()).toContain('Reasoning')
    expect(wrapper.text()).toContain('200')
  })

  it('hides the Reasoning column when no row has reasoning_tokens > 0', () => {
    const rows = [openaiUsage({ input_tokens: 100, output_tokens: 50 })]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    expect(wrapper.text()).not.toContain('Reasoning')
  })

  it('renders the empty-state message when there is no usage', () => {
    const wrapper = mountDetails({
      history: [],
      totals: null,
      detailsOpen: true,
    })
    expect(wrapper.find('[data-testid="usage-per-turn"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No usage yet.')
  })

  it('shows the per-turn table with one row per assistant turn', () => {
    const rows = [
      anthropicUsage({ input_tokens: 100, output_tokens: 50 }),
      anthropicUsage({ input_tokens: 200, output_tokens: 80 }),
      openaiUsage({ input_tokens: 1000, output_tokens: 100, cached_tokens: 200 }),
    ]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
      provider: 'openai',
    })
    const tableRows = wrapper.findAll('[data-testid^="usage-row-"]')
    expect(tableRows).toHaveLength(3)
  })

  it('respects an explicit provider prop over history-derived provider', () => {
    // Provider prop is forwarded so the summary and details panel can
    // stay in sync without sharing composable state.
    const rows = [openaiUsage()]
    const wrapper = mountDetails({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
      provider: 'anthropic',
    })
    expect(wrapper.find('[data-testid="usage-provider"]').text()).toBe('Anthropic')
    expect(wrapper.text()).toContain('Cache read')
  })
})
