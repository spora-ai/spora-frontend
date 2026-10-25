/**
 * CompactionMarker — the mark a compaction leaves in the transcript.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CompactionMarker from '@/components/agent/TaskChat/CompactionMarker.vue'

describe('CompactionMarker', () => {
  it('says how much was compacted', () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 6, summary: 'The operator asked for the schema.' },
    })

    expect(wrapper.find('[data-testid="compaction-marker"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('6 messages compacted')
    expect(wrapper.find('[data-testid="compaction-marker-details"]').exists()).toBe(false)
  })

  it('uses the singular for one message', () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 1, summary: 'The operator asked for the schema.' },
    })

    expect(wrapper.text()).toContain('1 message compacted')
  })

  it('says so plainly when the range does not name any turns', () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 0, summary: 'The operator asked for the schema.' },
    })

    expect(wrapper.text()).toContain('Conversation compacted')
  })

  it('shows the summary when expanded', async () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 6, summary: 'The operator asked for the schema.' },
    })

    await wrapper.find('[data-testid="compaction-marker-toggle"]').trigger('click')

    const details = wrapper.find('[data-testid="compaction-marker-details"]')
    expect(details.exists()).toBe(true)
    expect(details.text()).toContain('What the model was told')
    expect(details.text()).toContain('The operator asked for the schema.')
  })

  it('collapses again on a second click', async () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 6, summary: 'The operator asked for the schema.' },
    })

    const toggle = wrapper.find('[data-testid="compaction-marker-toggle"]')
    await toggle.trigger('click')
    await toggle.trigger('click')

    expect(wrapper.find('[data-testid="compaction-marker-details"]').exists()).toBe(false)
  })

  it('keeps the count on one line', () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 6, summary: 'The operator asked for the schema.' },
    })

    expect(wrapper.find('[data-testid="compaction-marker-toggle"] span').classes())
      .toContain('whitespace-nowrap')
  })

  it('wraps a long unbroken string in the summary instead of overflowing', async () => {
    const wrapper = mount(CompactionMarker, {
      props: { count: 1, summary: `https://example.test/${'x'.repeat(300)}` },
    })
    await wrapper.find('[data-testid="compaction-marker-toggle"]').trigger('click')

    // `min-w-0` lets the marker shrink inside the transcript's flex row —
    // a flex item does not shrink below its content's width on its own —
    // and `break-words` breaks the long token inside it.
    expect(wrapper.classes()).toContain('min-w-0')
    expect(wrapper.find('[data-testid="compaction-marker-summary"]').classes())
      .toContain('break-words')
  })
})
