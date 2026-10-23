/**
 * CompactedHistory — the collapsed block that stands in for the turns a
 * compaction replaced.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CompactedHistory from '@/components/agent/TaskChat/CompactedHistory.vue'
import type { CompactedHistory as Compacted } from '@/composables/useTaskChat'
import type { HistoryEntry } from '@/types/task'

function user(sequence: number, content: string): HistoryEntry {
  return { sequence, role: 'user', content, tool_call_id: null, tool_name: null }
}

function tool(sequence: number, content: string): HistoryEntry {
  return { sequence, role: 'tool', content, tool_call_id: 'c1', tool_name: 'read_url' }
}

function compacted(overrides: Partial<Compacted> = {}): Compacted {
  return {
    rows: [user(0, 'Q1'), tool(1, 'fetched'), user(2, 'Q2')],
    summary: 'The agent read the page and answered.',
    ...overrides,
  }
}

describe('CompactedHistory', () => {
  it('renders the collapsed state with the turn count', () => {
    const wrapper = mount(CompactedHistory, {
      props: { compacted: compacted() },
    })

    expect(wrapper.find('[data-testid="compacted-history"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2 turns compacted')
    expect(wrapper.find('[data-testid="compacted-history-details"]').exists()).toBe(false)
  })

  it('shows the summary and the compacted turns when expanded', async () => {
    const wrapper = mount(CompactedHistory, {
      props: { compacted: compacted() },
    })

    await wrapper.find('[data-testid="compacted-history-toggle"]').trigger('click')

    const details = wrapper.find('[data-testid="compacted-history-details"]')
    expect(details.exists()).toBe(true)
    expect(details.text()).toContain('The agent read the page and answered.')
    // The tool result is not a turn — it is left out of the list.
    expect(wrapper.find('[data-testid="compacted-turn-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="compacted-turn-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="compacted-turn-2"]').exists()).toBe(true)
  })

  it('collapses again on a second click', async () => {
    const wrapper = mount(CompactedHistory, {
      props: { compacted: compacted() },
    })

    const toggle = wrapper.find('[data-testid="compacted-history-toggle"]')
    await toggle.trigger('click')
    await toggle.trigger('click')

    expect(wrapper.find('[data-testid="compacted-history-details"]').exists()).toBe(false)
  })

  it('says so plainly when the compacted turns are no longer readable', () => {
    // A compaction made before the turns were kept left nothing to show.
    const wrapper = mount(CompactedHistory, {
      props: { compacted: compacted({ rows: [], summary: 'An older summary.' }) },
    })

    expect(wrapper.text()).toContain('Conversation compacted')
    expect(wrapper.text()).not.toContain('0 turns compacted')
  })

  it('falls back to the content blocks when a turn has no text', async () => {
    const wrapper = mount(CompactedHistory, {
      props: {
        compacted: compacted({
          rows: [
            {
              sequence: 0,
              role: 'assistant',
              content: null,
              content_blocks: [{ type: 'text', text: 'From the blocks' }],
              tool_call_id: null,
              tool_name: null,
            },
          ],
        }),
      },
    })

    await wrapper.find('[data-testid="compacted-history-toggle"]').trigger('click')

    expect(wrapper.find('[data-testid="compacted-turn-0"]').text()).toContain('From the blocks')
  })
})
