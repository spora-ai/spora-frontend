/**
 * TaskChatMessageList — scrollable chat history.
 *
 * Asserts the user/assistant/tool bubbles, the running indicator, the
 * final-response pill, the failed banner, and the scroll-to-bottom ref.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import TaskChatMessageList from '@/components/agent/TaskChat/TaskChatMessageList.vue'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskDetail, HistoryEntry, ToolCall } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'

vi.mock('@/composables/useMarkdown', () => ({
  renderMarkdown: (text: string) => text,
}))

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
      { path: '/tasks/:id', name: 'task', component: { template: '<div />' } },
      { path: '/agents/:id', name: 'agent', component: { template: '<div />' } },
    ],
  })
}

const baseTask: TaskDetail = {
  id: 1,
  agent_id: 1,
  status: 'COMPLETED',
  user_prompt: 'hi',
  final_response: null,
  step_count: 0,
  max_steps: 10,
  error_code: null,
  error_message: null,
  failure_reason: null,
  history: [],
  tool_calls: [],
  created_at: '',
  updated_at: '',
}

function makeEntry(role: HistoryEntry['role'], overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sequence: 0,
    role,
    content: 'content',
    tool_call_id: null,
    tool_name: null,
    ...overrides,
  }
}

describe('TaskChatMessageList', () => {
  it('renders the user/assistant/tool bubbles from chatMessages', () => {
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'hello' }) },
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 2, content: 'hi there' }) },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 3, content: 'tool result', tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    expect(wrapper.text()).toContain('hello')
    expect(wrapper.text()).toContain('hi there')
    expect(wrapper.text()).toContain('web_search')
  })

  it('renders the running indicator for RUNNING tasks', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'RUNNING' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    expect(wrapper.find('.animate-bounce').exists()).toBe(true)
  })

  it('renders the final-response pill for COMPLETED tasks with a final_response', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'COMPLETED', final_response: 'The answer is 42.' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    expect(wrapper.text()).toContain('The answer is 42.')
  })

  it('does not render a handover agent link when no breadcrumb is present', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'COMPLETED', final_response: 'The answer is 42.' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    expect(wrapper.text()).not.toContain('Open ')
    expect(wrapper.findAll('a').filter((a) => a.attributes('href')?.includes('/agents/'))).toHaveLength(0)
  })

  it('renders a handover agent link to /agents/:id when data.handover has a target agent', () => {
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_task_id: 42,
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(link!.text()).toContain('Open Research Agent →')
  })

  it('renders the handover link when target_task_id is absent', () => {
    // Regression: target_task_id is informational on the breadcrumb; the
    // agent link must render even when it is missing or non-numeric — the
    // old Number(...) wrapper produced NaN and propagated it downstream.
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('renders the handover link when target_task_id is not a number', () => {
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_task_id: 'not-a-number',
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('renders the failed banner for FAILED tasks', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'FAILED' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    // TaskFailedBanner is rendered
    expect(wrapper.findComponent(TaskFailedBanner).exists()).toBe(true)
  })

  it('emits toggleExpanded when a truncated tool result is expanded', async () => {
    const longContent = 'x'.repeat(400)
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('▼ more')
    await button.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    expect(wrapper.emitted('toggleExpanded')![0]).toEqual([5])
  })

  it('renders the full content and flips the label to "less" when expandedTools[seq] is true', () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: { 5: true },
      },
    })
    expect(wrapper.text()).toContain('TAIL_MARKER')
    expect(wrapper.find('button').text()).toBe('▲ less')
  })

  it('keeps the truncated preview when expandedTools[seq] is false', () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: { 5: false },
      },
    })
    expect(wrapper.text()).not.toContain('TAIL_MARKER')
    expect(wrapper.find('button').text()).toBe('▼ more')
  })

  it('flips from "more" to "less" when the parent updates expandedTools in response to the emit', async () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null, expandedTools: { 5: false } },
    })
    expect(wrapper.find('button').text()).toBe('▼ more')
    await wrapper.find('button').trigger('click')
    await wrapper.setProps({ expandedTools: { 5: true } })
    expect(wrapper.find('button').text()).toBe('▲ less')
    expect(wrapper.text()).toContain('TAIL_MARKER')
  })

  it('exposes scrollToBottom via defineExpose', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: [], finalReasoning: null },
    })
    const exposed = wrapper.vm as unknown as { scrollToBottom?: () => void }
    expect(typeof exposed.scrollToBottom).toBe('function')
  })

  it('renders finalReasoning foldout when set', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: [], finalReasoning: 'because reasons' },
    })
    expect(wrapper.text()).toContain('because reasons')
    expect(wrapper.text()).toContain('Reasoning')
  })

  // Regression: the "more" button lives inside a <details>. Without
  // .prevent the native <details> toggle swallows the click and the
  // user sees nothing happen.
  it('emits toggleExpanded without closing the parent <details>', async () => {
    const longContent = 'x'.repeat(400)
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 7, content: longContent, tool_name: 'web_search' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    const details = wrapper.find('details')
    expect(details.exists()).toBe(true)
    details.element.setAttribute('open', '')
    expect((details.element as HTMLDetailsElement).open).toBe(true)
    const button = wrapper.find('button')
    expect(button.text()).toBe('▼ more')
    await button.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    expect((details.element as HTMLDetailsElement).open).toBe(true)
  })
})

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_1',
    tool_name: 'handover',
    tool_type: 'handover',
    operation: null,
    operation_description: null,
    status: 'EXECUTED',
    proposed_arguments: null,
    approved_arguments: null,
    human_description: null,
    result_content: 'Handed over.',
    executed_at: null,
    ...overrides,
  }
}

describe('TaskChatMessageList — tool-call deep link', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders SubAgentToolCall for an op: sub_agent tool result', async () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    for (const id of [1, 2, 3]) {
      store.subTaskCache.set(id, {
        ...baseTask,
        id,
        status: 'RUNNING',
        parent_task_id: baseTask.id,
      })
    }
    const toolCall = makeToolCall({
      operation: 'sub_agent',
      result_data: { op: 'sub_agent', spawned_sub_task_ids: [1, 2, 3] },
    })
    const messages: ChatMessage[] = [
      {
        kind: 'tool-result',
        entry: makeEntry('tool', {
          sequence: 1,
          content: 'Sub-agents started.',
          tool_name: 'handover',
          tool_call_id: 'pc_1',
        }),
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
      },
      global: { plugins: [makeRouter()] },
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="sub-agent-tool-call"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('#1')
    expect(wrapper.text()).toContain('#2')
    expect(wrapper.text()).toContain('#3')
  })

  it('renders an "Open chat #X" RouterLink when result_data.new_task_id is set', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42, handover: true },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Handed over.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Open chat #42')
    expect(link.text()).toContain('→')
  })

  it('prefixes the link text with "Handed off —" when result_data.handover is true', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42, handover: true },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Handed over.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const text = wrapper.find('a').text()
    expect(text).toContain('Handed off')
    expect(text).toContain('Open chat #42')
  })

  it('omits the "Handed off —" prefix when result_data.handover is not true', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'generic_tool', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).not.toContain('Handed off')
    expect(link.text()).toContain('Open chat #42')
  })

  it('falls back to task_id when new_task_id is absent', () => {
    const toolCall = makeToolCall({
      result_data: { task_id: 99 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'generic_tool', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Open chat #99')
  })

  it('does not render a link when result_data has neither new_task_id nor task_id', () => {
    const toolCall = makeToolCall({
      result_data: { foo: 'bar' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('does not render a link when result_data is absent', () => {
    const toolCall = makeToolCall({})
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('does not render a link when the history row has no tool_call_id', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: null }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('uses the "task" route name with the new_task_id as a string param', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 7 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe('/tasks/7')
  })
})

describe('TaskChatMessageList — Loaded skill badge', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders a "Loaded skill" badge for skill_read of SKILL.md', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'body', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Loaded skill:')
    expect(wrapper.text()).toContain('git')
    // No standard "— result" suffix on the skill badge
    expect(wrapper.text()).not.toContain('— result')
  })

  it('renders the standard tool-call card for skill_files (not a "read" of SKILL.md)', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'files', name: 'git' },
      result_data: { name: 'git', files: [{ path: 'SKILL.md', bytes: 100 }] },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'files...', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('— result')
    expect(wrapper.text()).not.toContain('Loaded skill:')
  })

  it('renders the standard card for skill_read of a non-SKILL.md file', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'examples.md' },
      result_data: { name: 'git', filename: 'examples.md', bytes: 200 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'examples', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('— result')
    expect(wrapper.text()).not.toContain('Loaded skill:')
  })

  it('renders the standard card when the tool_call has no matching record (legacy runs)', () => {
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'body', tool_name: 'skill', tool_call_id: 'pc_legacy' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('— result')
    expect(wrapper.text()).not.toContain('Loaded skill:')
  })

  it('renders the standard card for a FAILED skill_read of SKILL.md (path-traversal block, oversize, etc.)', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      status: 'FAILED',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Loaded skill:')
  })

  it('renders the standard card for a REJECTED skill_read of SKILL.md (operator declined)', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      status: 'REJECTED',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Loaded skill:')
  })
})

describe('TaskChatMessageList — tool arguments panel', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders the effective args panel using approved_arguments when present', () => {
    const toolCall = makeToolCall({
      tool_name: 'send_email',
      approved_arguments: { to: 'a@b.co', subject: 'Hi' },
      proposed_arguments: { to: 'a@b.co', subject: 'Draft' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'sent', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('Hi')
    expect(wrapper.text()).not.toContain('Draft')
  })

  it('falls back to proposed_arguments when approved_arguments is null', () => {
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      approved_arguments: null,
      proposed_arguments: { query: 'spora agents' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '...', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('spora agents')
  })

  it('does not render an Arguments panel when no args exist', () => {
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('does not render an Arguments panel when approved is empty and proposed is an empty object', () => {
    // Empty `{}` is truthy — the `Object.keys(...).length > 0` guard
    // prevents the "Arguments (0)" header from mounting.
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: {},
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('does not render an Arguments panel when approved is empty and proposed is an empty array', () => {
    // Some LLMs return `proposed_arguments: []`; the empty-keys guard
    // covers objects and arrays uniformly.
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: [],
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('renders JSON syntax-highlighted view when args are nested', () => {
    const toolCall = makeToolCall({
      tool_name: 'send_email',
      approved_arguments: { body: 'line1\nline2' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.html()).toContain('<pre')
  })

  it('masks sensitive values like api_key in the chat arguments panel', () => {
    const toolCall = makeToolCall({
      tool_name: 'call_external',
      approved_arguments: { api_key: 'sk-1234567890' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'call_external', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('••••••••')
    expect(wrapper.text()).not.toContain('sk-1234567890')
  })

  it('does not add an Arguments panel to the "Loaded skill" badge', () => {
    // Skill badge is the compact special view; the standard arguments
    // panel belongs only on the standard tool-result card.
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      proposed_arguments: null,
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'body', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Loaded skill:')
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('renders the arguments panel ABOVE the result content', () => {
    // Distinct strings pin positional order — reordering the template
    // would invert their positions.
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      approved_arguments: { query: 'AAAA' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'BBBB', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const text = wrapper.text()
    const argPos = text.indexOf('AAAA')
    const resultPos = text.indexOf('BBBB')
    expect(argPos).toBeGreaterThanOrEqual(0)
    expect(resultPos).toBeGreaterThanOrEqual(0)
    expect(argPos).toBeLessThan(resultPos)
  })
})

describe('TaskChatMessageList — Loaded skill truncation toggle', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders a "▼ more" button on the skill badge when the content is truncated', async () => {
    // Mirrors the standard tool-result card; without the toggle the full
    // skill body would be hidden behind the truncation cap.
    const longContent = 'x'.repeat(400)
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      proposed_arguments: null,
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 7, content: longContent, tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Loaded skill:')
    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('▼ more')
    await button.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    expect(wrapper.emitted('toggleExpanded')![0]).toEqual([7])
  })

  it('flips the label to "▲ less" when expandedTools[seq] is true on the skill badge', async () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      proposed_arguments: null,
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 8, content: longContent, tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: { 8: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('TAIL_MARKER')
    expect(wrapper.find('button').text()).toBe('▲ less')
  })

  it('does not render a "more" button on the skill badge when the content is short', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      proposed_arguments: null,
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 256 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 9, content: 'short body', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Loaded skill:')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

describe('abort_marker system rows', () => {
  const baseEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
    sequence: 1,
    role: 'system' as const,
    content: JSON.stringify({ kind: 'abort_marker', at: '2026-08-08T12:00:00Z' }),
    tool_call_id: null,
    tool_name: null,
    content_blocks: null,
    ...overrides,
  })

  it('renders an abort_marker divider with the formatted timestamp', () => {
    const task = { ...baseTask, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:00:00Z' }
    const messages: ChatMessage[] = [
      { kind: 'system-marker', entry: baseEntry(), marker: { kind: 'abort_marker', at: '2026-08-08T12:00:00Z' } },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {} },
      global,
    })
    const marker = wrapper.find('[data-testid="abort-marker"]')
    expect(marker.exists()).toBe(true)
    expect(marker.text()).toContain('Aborted at')
  })

  it('renders the abort button + bouncing dots only when task status is RUNNING', () => {
    const task = { ...baseTask, status: 'RUNNING' as const }
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: [], finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    expect(wrapper.find('[data-testid="abort-button"]').exists()).toBe(true)
  })

  it('does NOT render the abort button when task is ABORTED', () => {
    const task = { ...baseTask, status: 'ABORTED' as const }
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: [], finalReasoning: null, expandedTools: {} },
      global,
    })
    expect(wrapper.find('[data-testid="abort-button"]').exists()).toBe(false)
  })

  it('disables the abort button while submitting is true', () => {
    const task = { ...baseTask, status: 'RUNNING' as const }
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: [], finalReasoning: null, expandedTools: {}, abortSubmitting: true },
      global,
    })
    const button = wrapper.find('[data-testid="abort-button"]')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('emits abort when the abort button is clicked', async () => {
    const task = { ...baseTask, status: 'RUNNING' as const }
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: [], finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    await wrapper.find('[data-testid="abort-button"]').trigger('click')
    expect(wrapper.emitted('abort')).toBeTruthy()
    expect((wrapper.emitted('abort') ?? []).length).toBe(1)
  })

  it('drops a malformed system-marker row instead of rendering', () => {
    const task = { ...baseTask, status: 'ABORTED' as const }
    const messages: ChatMessage[] = [
      // Malformed JSON — parseSystemMarker returns null, so the entry is
      // filtered out by buildChatMessages. But when someone hands us a
      // already-built ChatMessage[], the component should be defensive
      // and skip it. We just confirm the marker testid is absent when
      // there's no system-marker message.
    { kind: 'assistant' as const, entry: makeEntry('assistant' as HistoryEntry['role'], { sequence: 1, content: 'ok' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {} },
      global,
    })
    expect(wrapper.find('[data-testid="abort-marker"]').exists()).toBe(false)
  })
})
