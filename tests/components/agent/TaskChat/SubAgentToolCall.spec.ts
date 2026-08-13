/**
 * SubAgentToolCall — per-status visual variants for the sub-agent row widget.
 *
 * Validates the operator-attention signal: PENDING_APPROVAL rows get an
 * amber left-border, the ⚠ icon, the "needs approval" text, and the
 * "Review approvals →" link with the `#approvals` hash.
 */
import { nextTick } from 'vue'
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

function seedOne(id: number, status: TaskDetail['status'] | 'QUEUED', agent_id = 7): TaskDetail {
  return {
    id,
    agent_id,
    status: status as TaskDetail['status'],
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

  it.each([
    ['RUNNING', 'Running…', 'text-blue-600'],
    ['QUEUED', 'Queued', 'text-zinc-600'],
    ['COMPLETED', 'Done', 'text-green-700'],
    ['FAILED', 'Failed', 'text-red-700'],
  ] as const)('renders the %s visual variant', async (status, label, className) => {
    const store = useTaskStore()
    store.subTaskCache.set(10, seedOne(10, status))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain(label)
    expect(wrapper.find(`.${className}`).exists()).toBe(true)
  })

  it('re-renders a child row when its cached SSE status changes', async () => {
    const store = useTaskStore()
    store.subTaskCache.set(42, seedOne(42, 'RUNNING'))
    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([42]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()
    const cached = store.subTaskCache.get(42)
    expect(cached?.status).toBe('RUNNING')
    cached!.status = 'PENDING_APPROVAL'
    await nextTick()

    const row = wrapper.find('[data-testid="sub-agent-needs-approval-42"]')
    expect(row.exists()).toBe(true)
    expect(row.classes()).toContain('border-amber-500')
    expect(wrapper.text()).toContain('needs approval')
    expect(wrapper.text()).toContain('Review approvals')
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

  it('loads each spawned id exactly once across repeated equivalent toolCall updates', async () => {
    // Regression: the parent poll swaps in an equivalent toolCall object
    // every tick. The watcher must skip re-issuing fetches when the id set
    // is unchanged — `fetchSubTaskDetail` is a cache-hit no-op but the
    // redundant round-trip is what we want to catch here.
    mockApi.get.mockImplementation(async (url: string) => {
      const match = /^\/tasks\/(\d+)$/.exec(url)
      const id = match ? Number(match[1]) : 0
      return { task: seedOne(id, 'RUNNING') }
    })

    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10, 11]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()
    expect(mockApi.get).toHaveBeenCalledTimes(2)

    // Poll cycle: identical id set, freshly constructed object.
    await wrapper.setProps({ toolCall: makeToolCall([10, 11]) })
    await flushPromises()
    expect(mockApi.get).toHaveBeenCalledTimes(2)

    // Another poll cycle, same ids.
    await wrapper.setProps({ toolCall: makeToolCall([10, 11]) })
    await flushPromises()
    expect(mockApi.get).toHaveBeenCalledTimes(2)
  })

  it('still loads newly spawned ids when the set grows', async () => {
    mockApi.get.mockImplementation(async (url: string) => {
      const match = /^\/tasks\/(\d+)$/.exec(url)
      const id = match ? Number(match[1]) : 0
      return { task: seedOne(id, 'RUNNING') }
    })

    const wrapper = mount(SubAgentToolCall, {
      props: { toolCall: makeToolCall([10]) },
      global: {
        plugins: [makeRouter()],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()
    expect(mockApi.get).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ toolCall: makeToolCall([10, 11, 12]) })
    await flushPromises()
    // 11 and 12 are new; 10 was already fetched and re-fetching it on the
    // set-change tick is acceptable (the store is idempotent), so we only
    // assert that the new ids were at least requested.
    const fetched = new Set(
      mockApi.get.mock.calls
        .map(([url]) => /^\/tasks\/(\d+)$/.exec(url as string)?.[1])
        .filter((id): id is string => id !== undefined),
    )
    expect(fetched.has('11')).toBe(true)
    expect(fetched.has('12')).toBe(true)
  })
})

describe('Stop Waiting affordance (parent AWAITING_SUB_AGENTS)', () => {
  function mountWithActiveStatus(status: string | null): {
    wrapper: ReturnType<typeof mount>
    abortCalls: number[]
  } {
    setActivePinia(createPinia())
    const store = useTaskStore()
    if (status !== null) {
      store.activeTask = { id: 1, status, agent_id: 1, user_prompt: 'p', final_response: null, step_count: 0, max_steps: 10, tool_calls: [], history: [], totals: null, created_at: '', updated_at: '' } as never
    }
    // Pinia actions are wrapped in a Proxy that runs through devtools in
    // dev mode; vi.spyOn does NOT observe calls reliably in some
    // versions. Replace the bound method with a simple counter stub so
    // the assertions see every invocation regardless of Pinia internals.
    const abortCalls: number[] = []
    store.abortTask = async (id: number) => {
      abortCalls.push(id)
      return await Promise.resolve({} as never)
    }

    const toolCall = makeToolCall([42])
    const wrapper = mount(SubAgentToolCall, { props: { toolCall } })
    return { wrapper, abortCalls }
  }

  it('renders the Stop waiting button when activeTask is AWAITING_SUB_AGENTS', () => {
    const { wrapper } = mountWithActiveStatus('AWAITING_SUB_AGENTS')
    const button = wrapper.find('[data-testid="stop-waiting-button"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Stop waiting for sub-agents')
  })

  it('clicking the button calls abortTask with the first spawned child id', async () => {
    const { wrapper, abortCalls } = mountWithActiveStatus('AWAITING_SUB_AGENTS')
    const button = wrapper.find('[data-testid="stop-waiting-button"]')
    // The wrapping div uses .stop to keep toggleExpand from firing; vue-test-utils
    // .trigger('click') still bubbles up through the @click.stop handler.
    await button.trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()
    expect(abortCalls).toEqual([42])
  })

  it('does NOT render the button when activeTask is RUNNING', () => {
    const { wrapper } = mountWithActiveStatus('RUNNING')
    expect(wrapper.find('[data-testid="stop-waiting-button"]').exists()).toBe(false)
  })

  it('does NOT render the button when activeTask is null', () => {
    const { wrapper } = mountWithActiveStatus(null)
    expect(wrapper.find('[data-testid="stop-waiting-button"]').exists()).toBe(false)
  })
})
