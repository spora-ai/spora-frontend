/**
 * TaskUsageSummary — compact LLM usage summary in the chat header.
 *
 * The summary renders ONLY the always-visible two-line block: a row
 * with Input / Output counters, and a row with the Cache hit badge
 * plus the Show / Hide details toggle. The details panel is a SEPARATE
 * sibling component; the summary owns the toggle via v-model.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TaskUsageSummary from '@/components/TaskUsageSummary.vue'
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

function mountSummary(props: { history: HistoryEntry[]; totals: Usage | null; detailsOpen?: boolean }) {
  return mount(TaskUsageSummary, {
    props: {
      history: props.history,
      totals: props.totals,
      detailsOpen: props.detailsOpen ?? false,
    },
  })
}

describe('TaskUsageSummary', () => {
  it('renders Input and Output in the compact summary', () => {
    const rows = [anthropicUsage({ input_tokens: 1234, output_tokens: 567 })]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    const totalsRow = wrapper.find('[data-testid="usage-summary-row-totals"]')
    expect(totalsRow.exists()).toBe(true)
    expect(totalsRow.text()).toContain('Input')
    expect(totalsRow.text()).toContain('1,234')
    expect(totalsRow.text()).toContain('Output')
    expect(totalsRow.text()).toContain('567')
  })

  it('compact summary content is right-aligned', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })

    expect(wrapper.find('[data-testid="usage-summary"]').classes()).toContain('items-end')
    expect(wrapper.find('[data-testid="usage-summary-row-totals"]').classes()).toContain('justify-end')
    expect(wrapper.find('[data-testid="usage-summary-row-actions"]').classes()).toContain('justify-end')
  })

  it('renders the Cache hit badge when the rate is non-null', () => {
    const rows = [openaiUsage({ input_tokens: 1000, cached_tokens: 500 })]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    const badge = wrapper.find('[data-testid="usage-cache-hit"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('50.0%')
  })

  it('omits the Cache hit badge when there is no billable input', () => {
    const rows = [openaiUsage({ input_tokens: 0, output_tokens: 0, cached_tokens: 0 })]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    expect(wrapper.find('[data-testid="usage-cache-hit"]').exists()).toBe(false)
  })

  it('renders "Show details" by default and "Hide details" when open', async () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    const toggle = wrapper.find('[data-testid="usage-toggle"]')
    expect(toggle.text()).toContain('Show details')
    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="usage-toggle"]').text()).toContain('Hide details')
  })

  it('emits update:detailsOpen when the toggle button is clicked', async () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    await wrapper.find('[data-testid="usage-toggle"]').trigger('click')
    const updates = wrapper.emitted('update:detailsOpen')
    expect(updates).toBeDefined()
    expect(updates?.[0]).toEqual([true])
  })

  it('does not render a provider tag in the summary', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    expect(wrapper.find('[data-testid="usage-provider"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Anthropic')
    expect(wrapper.text()).not.toContain('OpenAI')
  })

  it('does not render the details panel (it lives in its own component)', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    expect(wrapper.find('[data-testid="usage-details"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="usage-per-turn"]').exists()).toBe(false)
  })

  it('respects the v-model detailsOpen prop on mount', () => {
    const rows = [anthropicUsage()]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
      detailsOpen: true,
    })
    expect(wrapper.find('[data-testid="usage-toggle"]').text()).toContain('Hide details')
  })

  it('shows the empty-state hint when there is no usage', () => {
    const wrapper = mountSummary({ history: [], totals: null })
    const empty = wrapper.find('[data-testid="usage-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toBe('No usage yet.')
    expect(empty.classes()).toContain('text-right')
  })

  it('uses locale thousands separators in the totals', () => {
    const rows = [anthropicUsage({ input_tokens: 1234567, output_tokens: 8910 })]
    const wrapper = mountSummary({
      history: rows.map((u, i) => assistantTurn(u, i)),
      totals: aggregate(rows),
    })
    expect(wrapper.text()).toContain('1,234,567')
    expect(wrapper.text()).toContain('8,910')
  })
})
