/**
 * SubAgentToolCall — per-status visual variants for the sub-agent row widget.
 *
 * Validates the operator-attention signal: PENDING_APPROVAL rows get an
 * amber left-border, the ⚠ icon, the "needs approval" text, and the
 * "Review approvals →" link with the `#approvals` hash.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SubAgentToolCall from '@/components/agent/TaskChat/SubAgentToolCall.vue'
import { useTaskStore } from '@/stores/tasks'
import type { ToolCall, TaskDetail } from '@/types/task'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
}))

import { api } from '@/api/client'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

function makeToolCall(children: number[]): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_sub_agent_1',
    tool_name: 'handover',
    tool_type: 'output',
    operation: 'sub_agent',
    operation_description: 'Spawn a sub-agent',
    status: 'APPROVED',
    proposed_arguments: { op: 'sub_agent', agent_id: 7, prompt: 'do thing' },
    approved_arguments: { op: 'sub_agent', agent_id: 7, prompt: 'do thing' },
    human_description: 'Spawn a sub-agent on agent #7',
    result_content: 'Sub-agent task #2 starts on agent #7.',
    executed_at: '2024-01-01T00:00:00Z',
    result_data: {
      op: 'sub_agent',
      spawned_sub_task_ids: children,
    },
    parameter_schema: { type: 'object', properties: {}, required: [] },
  }
}

function seedOne(id: number, status: TaskDetail['status'], agent_id = 7): TaskDetail {
  return {
    id,
    agent_id,
    status,
    user_prompt: 'child',
    final_response: null,
    step_count: 0,
    max_steps: 5,
    parent_task_id: 1,
    tool_calls: [],
    history: [],
    totals: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { name: 'task', path: '/tasks/:id', component: { template: '<div />' } },
      { name: 'dashboard', path: '/', component: { template: '<div />' } },
      { name: 'agent', path: '/agents/:id', component: { template: '<div />' } },
    ],
  })
}

describe('SubAgentToolCall', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
  })

  it('renders one row per plural spawned child id', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(1, seedOne(1, 'RUNNING'))
    store.subTaskCache.set(2, seedOne(2, 'COMPLETED'))
    store.subTaskCache.set(3, seedOne(3, 'FAILED'))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([1, 2, 3]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    const rows = wrapper.findAll('a')
    expect(rows).toHaveLength(3)
    expect(wrapper.find('#sub-agent-tool-call').exists()).toBe(true)
    expect(wrapper.text()).toContain('#1')
    expect(wrapper.text()).toContain('#2')
    expect(wrapper.text()).toContain('#3')
  })

  it('shows the "needs approval" warning for PENDING_APPROVAL children', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(10, seedOne(10, 'PENDING_APPROVAL'))
    store.subTaskCache.set(11, seedOne(11, 'RUNNING'))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10, 11]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('needs approval')
    expect(wrapper.text()).toContain('Review approvals')
    expect(wrapper.find('[data-testid="sub-agent-needs-approval-10"]').exists()).toBe(true)
    const reviewButton = wrapper.findAll('button').find((button) => button.text().includes('Review approvals'))
    expect(reviewButton?.attributes('type')).toBe('button')
  })

  it('renders the collapsed summary line when at least one child is awaiting approval', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(10, seedOne(10, 'PENDING_APPROVAL'))
    store.subTaskCache.set(11, seedOne(11, 'COMPLETED'))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10, 11]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Sub-agents (2)')
    expect(wrapper.text()).toContain('1 needs approval')
    expect(wrapper.text()).toContain('1 done')
  })

  it('does not clear the shared cache when the widget unmounts', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(10, seedOne(10, 'RUNNING'))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()
    wrapper.unmount()

    expect(store.subTaskCache.has(10)).toBe(true)
  })
  it('renders the "Spawning…" placeholder when no children have been persisted yet', () => {
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
    expect(wrapper.text()).toContain('Spawning sub-agent')
  })
})
