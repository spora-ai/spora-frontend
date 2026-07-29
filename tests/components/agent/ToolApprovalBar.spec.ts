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

  it('shows Submit but hides bulk controls when only one tool is pending', () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall()] },
      global,
    })

    const submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))
    expect(submit).toBeDefined()
    expect(wrapper.find('[data-test="approval-reject-all"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="approval-approve-all"]').exists()).toBe(false)
  })

  it('enables Submit Decision after the single card is approved', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall({ id: 1, provider_call_id: 'pc_1' })] },
      global,
    })

    const submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))!
    expect(submit.text()).toContain('1 to decide')
    expect(submit.attributes('disabled')).toBeDefined()

    const card = wrapper.findComponent({ name: 'ToolApprovalCard' })
    await card.findAll('button')[0].trigger('click')

    const ready = wrapper.findAll('button').find(b => b.text().includes('Submit Decision'))!
    expect(ready.attributes('disabled')).toBeUndefined()
  })

  it('emits submit-decisions with one entry when only one tool is pending', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall({ id: 1, provider_call_id: 'pc_1', proposed_arguments: { to: 'a@b.c' } })] },
      global,
    })

    const card = wrapper.findComponent({ name: 'ToolApprovalCard' })
    await card.findAll('button')[0].trigger('click')

    const submit = wrapper.findAll('button').find(b => b.text().includes('Submit Decision'))!
    await submit.trigger('click')

    const events = wrapper.emitted('submit-decisions')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({
      decisions: [{ providerCallId: 'pc_1', decision: 'approve', arguments: { to: 'a@b.c' } }],
    })
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
    expect(wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))).toBeDefined()
    expect(wrapper.findAll('button').find(b => b.text().includes('Reject All'))).toBeDefined()
    expect(wrapper.find('[data-test="approval-approve-all"]').exists()).toBe(true)
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

    const submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))!
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
    let submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))!
    expect(submit.attributes('disabled')).toBeDefined()

    // Second card decides — submit becomes enabled.
    await cards[1].findAll('button')[0].trigger('click')
    expect(wrapper.text()).toContain('2 of 2 decided')
    submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))!
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
    const payload = events![0][0] as { decisions: Array<{ providerCallId: string; decision: string; arguments?: Record<string, unknown> }> }
    expect(payload.decisions).toHaveLength(2)
    expect(payload.decisions[0]).toEqual({ providerCallId: 'pc_1', decision: 'approve', arguments: { to: 'a@b.c' } })
    expect(payload.decisions[1]).toEqual({ providerCallId: 'pc_2', decision: 'approve', arguments: { to: 'x@y.z' } })
  })

  it('reveals the reject reason input then emits reject-all with reason', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [makeToolCall({ id: 1 }), makeToolCall({ id: 2, provider_call_id: 'pc_2' })],
      },
      global,
    })

    const rejectAll = wrapper.find('[data-test="approval-reject-all"]')
    await rejectAll.trigger('click')

    const reasonInput = wrapper.findAll('input[type="text"]').find(
      i => (i.attributes('placeholder') ?? '').includes("rejecting all"),
    )!
    await reasonInput.setValue('not what I asked for')

    const confirm = wrapper.find('[data-test="approval-reject-confirm"]')
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

  it('disables the Reject All opener + confirmation buttons while rejecting is true', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [makeToolCall({ id: 1 }), makeToolCall({ id: 2, provider_call_id: 'pc_2' })],
        rejecting: true,
      },
      global,
    })

    const rejectAll = wrapper.find('[data-test="approval-reject-all"]')
    expect(rejectAll.exists()).toBe(true)
    expect(rejectAll.attributes('disabled')).toBeDefined()
    expect(rejectAll.text()).toBe('Rejecting…')

    // Force the input open so we can assert the confirm + cancel states too.
    await wrapper.setProps({ rejecting: false })
    await rejectAll.trigger('click')
    await wrapper.setProps({ rejecting: true })

    const confirm = wrapper.find('[data-test="approval-reject-confirm"]')
    const cancel = wrapper.find('[data-test="approval-reject-cancel"]')
    expect(confirm.exists()).toBe(true)
    expect(cancel.exists()).toBe(true)
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.text()).toBe('Rejecting…')
    expect(cancel.attributes('disabled')).toBeDefined()
  })

  it('enables Submit when two cards share the same provider_call_id and both are approved (defence against duplicate IDs)', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: {
        pending: [
          makeToolCall({ id: 1, provider_call_id: 'pc_dup' }),
          makeToolCall({ id: 2, provider_call_id: 'pc_dup' }),
        ],
      },
      global,
    })

    const cards = wrapper.findAllComponents({ name: 'ToolApprovalCard' })
    await cards[0].findAll('button')[0].trigger('click')
    expect(wrapper.text()).toContain('1 of 2 decided')

    let submit = wrapper.findAll('button').find(b => /Submit|decide|approve|rejected/.test(b.text()))!
    expect(submit.attributes('disabled')).toBeDefined()

    await cards[1].findAll('button')[0].trigger('click')
    expect(wrapper.text()).toContain('2 of 2 decided')
    submit = wrapper.findAll('button').find(b => b.text().includes('Submit Decisions'))!
    expect(submit.attributes('disabled')).toBeUndefined()
  })

  it('approves all remaining cards and hides the bulk button', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [
        makeToolCall({ id: 1 }),
        makeToolCall({ id: 2, provider_call_id: 'pc_2' }),
        makeToolCall({ id: 3, provider_call_id: 'pc_3' }),
      ] },
      global,
    })
    await wrapper.find('[data-test="approval-approve-all"]').trigger('click')
    expect(wrapper.text()).toContain('3 of 3 decided')
    expect(wrapper.find('[data-test="approval-approve-all"]').exists()).toBe(false)
  })

  it('emits mixed approve and reject decisions', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall(), makeToolCall({ id: 2, provider_call_id: 'pc_2' })] },
      global,
    })
    const cards = wrapper.findAllComponents({ name: 'ToolApprovalCard' })
    await cards[0].findAll('button')[0].trigger('click')
    await cards[1].findAll('button')[1].trigger('click')
    await wrapper.find('[data-test="approval-submit"]').trigger('click')
    expect(wrapper.emitted('submit-decisions')![0][0]).toEqual({ decisions: [
      { providerCallId: 'pc_1', decision: 'approve', arguments: { to: 'a@b.c' } },
      { providerCallId: 'pc_2', decision: 'reject' },
    ] })
  })

  it('shows approval and rejection counts and submit padding', async () => {
    const wrapper = mount(ToolApprovalBar, {
      props: { pending: [makeToolCall(), makeToolCall({ id: 2, provider_call_id: 'pc_2' }), makeToolCall({ id: 3, provider_call_id: 'pc_3' })] },
      global,
    })
    const cards = wrapper.findAllComponents({ name: 'ToolApprovalCard' })
    await cards[0].findAll('button')[0].trigger('click')
    await cards[1].findAll('button')[0].trigger('click')
    await cards[2].findAll('button')[1].trigger('click')
    const submit = wrapper.find('[data-test="approval-submit"]')
    expect(submit.text()).toBe('✓ Submit Decisions')
    expect(submit.classes()).toContain('px-3')
  })

  it('flips a rejected card to approved', async () => {
    const wrapper = mount(ToolApprovalBar, { props: { pending: [makeToolCall()] }, global })
    const card = wrapper.findComponent({ name: 'ToolApprovalCard' })
    await card.findAll('button')[1].trigger('click')
    await card.findAll('button')[0].trigger('click')
    expect(card.props('decided')).toBe(true)
    expect(card.props('rejected')).toBe(false)
  })

})
