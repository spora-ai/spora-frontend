import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolApprovalBar from '@/components/agent/ToolApprovalBar.vue'
import type { ToolCall } from '@/types/task'

const global = { stubs: { Icon: true } }

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_1',
    tool_name: 'send_email',
    tool_type: 'output',
    operation: null,
    operation_description: null,
    status: 'PENDING_APPROVAL',
    proposed_arguments: { to: 'a@b.c' },
    approved_arguments: null,
    human_description: 'Send email',
    result_content: null,
    executed_at: null,
    ...overrides,
  }
}

describe('ToolApprovalBar', () => {
  it('renders the singular header for one pending tool', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall()] },
      global,
    })

    expect(wrapper.text()).toContain('Tool approval required')
    expect(wrapper.text()).not.toContain('approvals required')
  })

  it('renders the plural header with count for multiple pending tools', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [
          makeToolCall({ id: 1 }),
          makeToolCall({ id: 2, provider_call_id: 'pc_2' }),
          makeToolCall({ id: 3, provider_call_id: 'pc_3' }),
        ],
      },
      global,
    })

    expect(wrapper.text()).toContain('3 tool approvals required')
  })

  it('hides the Submit/Reject-All controls when only one tool is pending', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall()] },
      global,
    })

    expect(wrapper.findAll('button').find(b => /Submit|Decide/.test(b.text()))).toBeUndefined()
    expect(wrapper.findAll('button').find(b => b.text().includes('Reject All'))).toBeUndefined()
  })

  it('shows the Submit and Reject All controls when more than one tool is pending', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [makeToolCall({ id: 1 }), makeToolCall({ id: 2, provider_call_id: 'pc_2' })],
      },
      global,
    })

    // The submit button text toggles between "Submit Decisions" (all decided)
    // and "Decide on N more" (waiting), so check for either.
    expect(wrapper.findAll('button').find(b => /Submit|Decide/.test(b.text()))).toBeDefined()
    expect(wrapper.findAll('button').find(b => b.text().includes('Reject All'))).toBeDefined()
  })

  it('disables the Submit button when not every card has decided', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [
          makeToolCall({ id: 1, provider_call_id: 'pc_1' }),
          makeToolCall({ id: 2, provider_call_id: 'pc_2' }),
        ],
      },
      global,
    })

    const submit = wrapper.findAll('button').find(b => /Submit|Decide/.test(b.text()))!
    expect(submit.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('0 of 2 decided')
  })

  it('enables the Submit button only after every card has decided (per-card flip)', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [
          makeToolCall({ id: 1, provider_call_id: 'pc_1' }),
          makeToolCall({ id: 2, provider_call_id: 'pc_2' }),
        ],
      },
      global,
    })

    const cards = wrapper.findAllComponents({ name: 'ToolApprovalCard' })
    expect(cards).toHaveLength(2)

    // First card decides — submit stays disabled, count becomes 1/2.
    await cards[0].findAll('button')[0].trigger('click')
    expect(wrapper.text()).toContain('1 of 2 decided')
    let submit = wrapper.findAll('button').find(b => /Submit|Decide/.test(b.text()))!
    expect(submit.attributes('disabled')).toBeDefined()

    // Second card decides — submit becomes enabled.
    await cards[1].findAll('button')[0].trigger('click')
    expect(wrapper.text()).toContain('2 of 2 decided')
    submit = wrapper.findAll('button').find(b => /Submit|Decide/.test(b.text()))!
    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('emits submit-decisions with the per-card decided arguments when Submit is clicked', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [
          makeToolCall({ id: 1, provider_call_id: 'pc_1', proposed_arguments: { to: 'a@b.c' } }),
          makeToolCall({ id: 2, provider_call_id: 'pc_2', proposed_arguments: { to: 'x@y.z' } }),
        ],
      },
      global,
    })

    const cards = wrapper.findAllComponents({ name: 'ToolApprovalCard' })
    await cards[0].findAll('button')[0].trigger('click')
    await cards[1].findAll('button')[0].trigger('click')

    // After both cards decided, the button switches to the "Submit Decisions" text.
    const submit = wrapper.findAll('button').find(b => b.text().includes('Submit Decisions'))!
    await submit.trigger('click')

    const events = wrapper.emitted('submit-decisions')
    expect(events).toBeTruthy()
    const payload = events![0][0] as { approvals: Array<{ providerCallId: string; arguments: Record<string, unknown> }> }
    expect(payload.approvals).toHaveLength(2)
    expect(payload.approvals[0]).toEqual({ providerCallId: 'pc_1', arguments: { to: 'a@b.c' } })
    expect(payload.approvals[1]).toEqual({ providerCallId: 'pc_2', arguments: { to: 'x@y.z' } })
  })

  it('reveals the reject reason input then emits reject-all with reason', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [makeToolCall({ id: 1 }), makeToolCall({ id: 2, provider_call_id: 'pc_2' })],
      },
      global,
    })

    const rejectAll = wrapper.findAll('button').find(b => b.text().includes('Reject All'))!
    await rejectAll.trigger('click')

    const reasonInput = wrapper.findAll('input[type="text"]').find(
      i => (i.attributes('placeholder') ?? '').includes("rejecting all"),
    )!
    await reasonInput.setValue('not what I asked for')

    const confirm = wrapper.findAll('button').find(b => b.text().includes('Confirm Reject All'))!
    await confirm.trigger('click')

    const events = wrapper.emitted('reject-all')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ reason: 'not what I asked for' })
  })

  it('renders the approveError when provided', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall()], approveError: 'Network failed' },
      global,
    })

    expect(wrapper.text()).toContain('Network failed')
  })
})
