/**
 * TodoToolCall — per-row render in the chat timeline for the
 * `todo` tool's `write` op. The compact "Plan updated" row keeps the
 * chat history lean while still surfacing the agent's commit to a
 * plan.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TodoToolCall from '@/components/agent/TaskChat/TodoToolCall.vue'
import type { ToolCall } from '@/types/task'

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_todo_1',
    tool_name: 'todo',
    tool_type: 'meta',
    operation: 'write',
    operation_description: 'Write the task list',
    status: 'EXECUTED',
    proposed_arguments: { todos: [] },
    approved_arguments: { todos: [] },
    human_description: 'Update the task list',
    result_content: '- [in_progress] Writing summary\n- [pending] Cross-check headlines',
    executed_at: '2026-09-19T10:30:00Z',
    result_data: null,
    parameter_schema: { type: 'object', properties: {}, required: [] },
    ...overrides,
  }
}

describe('TodoToolCall', () => {
  it('renders a "Plan updated" row with a chevron toggle', () => {
    const wrapper = mount(TodoToolCall, {
      props: { toolCall: makeToolCall() },
    })
    expect(wrapper.find('[data-testid="todo-tool-call"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('todo')
    expect(wrapper.text()).toContain('plan updated')
  })

  it('starts collapsed and reveals the result content on toggle', async () => {
    const wrapper = mount(TodoToolCall, {
      props: { toolCall: makeToolCall() },
    })
    expect(wrapper.find('#todo-tool-call-body').exists()).toBe(false)

    await wrapper.find('[data-testid="todo-tool-call-toggle"]').trigger('click')
    expect(wrapper.find('#todo-tool-call-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('Writing summary')
    expect(wrapper.text()).toContain('Cross-check headlines')
  })

  it('falls back to an empty body when result_content is null', async () => {
    const wrapper = mount(TodoToolCall, {
      props: { toolCall: makeToolCall({ result_content: null }) },
    })
    await wrapper.find('[data-testid="todo-tool-call-toggle"]').trigger('click')
    expect(wrapper.find('#todo-tool-call-body').exists()).toBe(true)
    expect(wrapper.find('#todo-tool-call-body').text()).toBe('')
  })
})
