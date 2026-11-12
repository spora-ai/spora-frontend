/**
 * CompactToolStreamRow — the row that renders a tool result, and the live
 * embed that can accompany one.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CompactToolStreamRow from '@/components/agent/TaskChat/CompactToolStreamRow.vue'
import type { ToolCall } from '@/types/task'

function toolCall(resultData: Record<string, unknown> | null): ToolCall {
  return {
    id: 1,
    provider_call_id: 'call-1',
    tool_name: 'media',
    tool_type: 'output',
    operation: 'create_media',
    operation_description: null,
    status: 'EXECUTED',
    proposed_arguments: null,
    approved_arguments: null,
    human_description: null,
    result_content: 'Media asset abc created.',
    executed_at: null,
    result_data: resultData,
  }
}

function mountRow(resultData: Record<string, unknown> | null) {
  return mount(CompactToolStreamRow, {
    props: {
      kind: 'tool',
      toolCall: toolCall(resultData),
      toolResult: { kind: 'tool-result', entry: { sequence: 1, content: 'Media asset abc created.' } },
      expanded: true,
      taskId: 1,
    } as never,
    global: {
      stubs: {
        RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
}

describe('CompactToolStreamRow — the embed', () => {
  it('renders no embed when the tool result carries no descriptor', () => {
    const wrapper = mountRow({ asset_id: 'abc', mime_type: 'text/html' })

    expect(wrapper.find('[data-testid="media-embed-frame"]').exists()).toBe(false)
  })

  it('renders the embed the server described', () => {
    const wrapper = mountRow({
      asset_id: 'abc',
      mime_type: 'text/html',
      embed_descriptor: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    const frame = wrapper.find('[data-testid="media-embed-iframe"]')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe('/api/v1/media/abc/embed')
  })

  it('sandboxes without allow-scripts when the server withheld them', () => {
    const wrapper = mountRow({
      embed_descriptor: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: false },
    })

    expect(wrapper.find('[data-testid="media-embed-iframe"]').attributes('sandbox')).toBe('')
  })

  it('allows scripts only when the server said they may run', () => {
    const wrapper = mountRow({
      embed_descriptor: { url: '/api/v1/media/abc/embed', mime: 'text/html', scripts: true },
    })

    expect(wrapper.find('[data-testid="media-embed-iframe"]').attributes('sandbox')).toBe('allow-scripts')
  })

  it('ignores a descriptor that is missing its url', () => {
    const wrapper = mountRow({
      embed_descriptor: { mime: 'text/html', scripts: true },
    })

    expect(wrapper.find('[data-testid="media-embed-frame"]').exists()).toBe(false)
  })

  it('ignores a descriptor that is not an object', () => {
    const wrapper = mountRow({ embed_descriptor: 'not-a-descriptor' })

    expect(wrapper.find('[data-testid="media-embed-frame"]').exists()).toBe(false)
  })

  it('ignores a descriptor pointing at another origin', () => {
    // The descriptor is server-supplied data, and an iframe is a stronger
    // primitive than an image: the client does not take the URL on trust.
    for (const url of ['https://attacker.example/x', '//attacker.example/x', 'javascript:alert(1)']) {
      const wrapper = mountRow({
        embed_descriptor: { url, mime: 'text/html', scripts: true },
      })

      expect(wrapper.find('[data-testid="media-embed-frame"]').exists()).toBe(false)
    }
  })
})

/**
 * The handover link: the row the tool result points at.
 *
 * The task id arrives untyped, so it can be an object — `String()` on one
 * renders "[object Object]", which the operator would read as a broken link.
 */
describe('CompactToolStreamRow — the handover link', () => {
  it('links to a numeric task id', () => {
    const wrapper = mountRow({ new_task_id: 42 })

    const link = wrapper.findComponent({ name: 'RouterLink' })
    expect(link.props('to')).toEqual({ name: 'task', params: { id: '42' } })
    expect(wrapper.text()).toContain('Open chat #42')
  })

  it('links to a string task id as it is', () => {
    const wrapper = mountRow({ task_id: '42' })

    const link = wrapper.findComponent({ name: 'RouterLink' })
    expect(link.props('to')).toEqual({ name: 'task', params: { id: '42' } })
    expect(wrapper.text()).toContain('Open chat #42')
  })

  it('renders an object task id as JSON instead of "[object Object]"', () => {
    const wrapper = mountRow({ new_task_id: { id: 42 } })

    const link = wrapper.findComponent({ name: 'RouterLink' })
    expect(link.props('to')).toEqual({ name: 'task', params: { id: '{"id":42}' } })
    expect(wrapper.text()).toContain('Open chat #{"id":42}')
    expect(wrapper.text()).not.toContain('[object Object]')
  })

  it('renders a task id that cannot be serialised as "[object Object]"', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const wrapper = mountRow({ new_task_id: circular })

    const link = wrapper.findComponent({ name: 'RouterLink' })
    expect(link.props('to')).toEqual({ name: 'task', params: { id: '[object Object]' } })
    expect(wrapper.text()).toContain('Open chat #[object Object]')
  })

  it('renders no link when the result carries no task id', () => {
    const wrapper = mountRow({ asset_id: 'abc' })

    expect(wrapper.findComponent({ name: 'RouterLink' }).exists()).toBe(false)
  })
})
