import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolApprovalCard from '@/components/agent/ToolApprovalCard.vue'
import type { ToolCall } from '@/types/task'

const global = { stubs: { Icon: true } }

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_abc',
    tool_name: 'send_email',
    tool_type: 'output',
    operation: 'send_email',
    operation_description: 'Send an email to a recipient',
    status: 'PENDING_APPROVAL',
    proposed_arguments: { to: 'a@b.c', subject: 'hi', body: 'msg' },
    approved_arguments: null,
    human_description: null,
    result_content: null,
    executed_at: null,
    parameter_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to'],
    },
    ...overrides,
  }
}

describe('ToolApprovalCard', () => {
  it('renders the tool name, operation badge, and operation description', () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall() },
      global,
    })

    expect(wrapper.text()).toContain('send_email')
    expect(wrapper.text()).toContain('Send an email to a recipient')
  })

  it('falls back to human_description when operation_description is null', () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall({ operation_description: null, human_description: 'Send the recap email' }) },
      global,
    })

    expect(wrapper.text()).toContain('Send the recap email')
  })

  it('emits update:decided with decided=true when Approve is clicked', async () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall() },
      global,
    })

    // The first button inside the component is the Approve button.
    await wrapper.find('button').trigger('click')

    const events = wrapper.emitted('update:decided')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ cardId: 1, providerCallId: 'pc_abc', decided: true })
  })

  it('emits update:arguments with the parsed JSON arguments on Approve', async () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall() },
      global,
    })

    await wrapper.find('button').trigger('click')

    const events = wrapper.emitted('update:arguments')
    expect(events).toBeTruthy()
    const last = events![events!.length - 1][0]
    expect(last).toEqual({
      providerCallId: 'pc_abc',
      arguments: { to: 'a@b.c', subject: 'hi', body: 'msg' },
    })
  })

  it('switches to the Approved/Undo button when the decided prop is true', async () => {
    // Initially undecided.
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall(), decided: false },
      global,
    })
    expect(wrapper.text()).toContain('Approve')
    expect(wrapper.text()).not.toContain('Undo')

    await wrapper.setProps({ decided: true })

    expect(wrapper.text()).toContain('Approved')
    expect(wrapper.text()).toContain('Undo')
    expect(wrapper.text()).not.toMatch(/^✓ Approve$/m)
    expect(wrapper.text()).toContain('Reject')
  })

  it('emits update:decided with decided=false when the Undo button is clicked', async () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall(), decided: true },
      global,
    })

    const undo = wrapper.findAll('button').find(b => b.text().includes('Undo'))!
    await undo.trigger('click')

    const events = wrapper.emitted('update:decided')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ cardId: 1, providerCallId: 'pc_abc', decided: false })
  })

  it('disables both Approve and Undo buttons when submitting is true', async () => {
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall(), submitting: true },
      global,
    })
    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()

    await wrapper.setProps({ decided: true })
    const undo = wrapper.findAll('button').find(b => b.text().includes('Undo'))!
    expect(undo.attributes('disabled')).toBeDefined()
  })

  it('uses the parameter_schema property order in the embedded editor', () => {
    // The schema declares [to, subject, body]; the LLM emitted them in the same
    // order, so this test mostly checks the prop is forwarded — order behaviour
    // itself is covered by ToolArgumentsEditor.spec.ts.
    const wrapper = mount(ToolApprovalCard, {
      props: { toolCall: makeToolCall() },
      global,
    })

    const labels = wrapper.findAll('label').map(l => l.text()).filter(t => ['To', 'Subject', 'Body'].includes(t))
    expect(labels).toEqual(['To', 'Subject', 'Body'])
  })

  it('shows rejected state and a red border', () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), rejected: true }, global })
    expect(wrapper.text()).toContain('Rejected — Undo')
    expect(wrapper.classes()).toContain('border-red-300')
  })

  it('emits update:rejected when Reject is clicked', async () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall() }, global })
    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('update:rejected')![0][0]).toEqual({ cardId: 1, providerCallId: 'pc_abc', rejected: true })
  })

  it('clears rejection before approving a rejected card', async () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), rejected: true }, global })
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('update:rejected')![0][0]).toEqual({ cardId: 1, providerCallId: 'pc_abc', rejected: false })
    expect(wrapper.emitted('update:decided')![0][0]).toEqual({ cardId: 1, providerCallId: 'pc_abc', decided: true })
  })

  it('disables and pads the Reject button', () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), submitting: true }, global })
    const reject = wrapper.findAll('button')[1]
    expect(reject.attributes('disabled')).toBeDefined()
    expect(reject.classes()).toContain('px-3')
  })

  it('does not render the reason input when not rejected', () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall() }, global })
    expect(wrapper.find('[data-test="approval-reason-input"]').exists()).toBe(false)
  })

  it('renders an empty reason input when rejected', () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), rejected: true }, global })
    const input = wrapper.find('[data-test="approval-reason-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('placeholder')).toContain('Why are you rejecting')
  })

  it('emits update:reason with the typed value', async () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), rejected: true }, global })
    await wrapper.find('[data-test="approval-reason-input"]').setValue('wrong recipient')
    expect(wrapper.emitted('update:reason')![0][0]).toEqual({ cardId: 1, reason: 'wrong recipient' })
  })

  it('hydrates the reason input from the reason prop', async () => {
    const wrapper = mount(ToolApprovalCard, { props: { toolCall: makeToolCall(), rejected: true, reason: 'pre-existing' }, global })
    expect((wrapper.find('[data-test="approval-reason-input"]').element as HTMLInputElement).value).toBe('pre-existing')

    await wrapper.setProps({ reason: 'updated' })
    expect((wrapper.find('[data-test="approval-reason-input"]').element as HTMLInputElement).value).toBe('updated')
  })

})
