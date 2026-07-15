/**
 * DashboardAgentCard — verifies the multi-state pill row, recent chats,
 * click-emit selection, and kebab action wiring. `useDashboardData` is
 * mocked so the card reads from a controlled in-memory task list without
 * going through Pinia's stores.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'

import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import type { Agent } from '@/types/agent'
import type { Task, TaskStatus } from '@/types/task'

const tasksRef: Ref<Task[]> = ref([])
const activeStatesRef: Ref<Map<number, Set<TaskStatus>>> = ref(new Map())
const ensureLoaded = vi.fn()
const refresh = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    tasks: tasksRef,
    activeStatesByAgent: activeStatesRef,
    agents: { value: [] },
    kpiCounts: { value: { agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 } },
    filteredAgents: { value: [] },
    ensureLoaded,
    refresh,
    lastUpdatedAt: { value: null },
    isLoading: { value: false },
    isRefreshing: { value: false },
    state: {
      chip: { value: 'all' },
      query: { value: '' },
      sort: { value: 'activity' },
    },
    setChip: vi.fn(),
    setQuery: vi.fn(),
    setSort: vi.fn(),
  }),
}))

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'Calendar Wrangler',
    description: 'Keeps my calendar tidy',
    system_prompt: null,
    llm_driver_config_id: null,
    max_steps: 10,
    is_active: true,
    tools: [{ tool_class: 'CalendarTool', tool_name: 'calendar' }],
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    agent_id: 1,
    status: 'RUNNING',
    user_prompt: 'Schedule a meeting',
    final_response: null,
    step_count: 3,
    max_steps: 10,
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:01Z',
    ...overrides,
  }
}

describe('DashboardAgentCard', () => {
  beforeEach(() => {
    tasksRef.value = []
    activeStatesRef.value = new Map()
    ensureLoaded.mockClear()
    refresh.mockClear()
  })

  it('renders avatar, name, description, and the multi-state pills', () => {
    const agent = makeAgent()
    tasksRef.value = [
      makeTask({ id: 1, status: 'RUNNING' }),
      makeTask({ id: 2, status: 'PENDING_APPROVAL', user_prompt: 'approve me' }),
    ]
    activeStatesRef.value = new Map([[1, new Set(['RUNNING', 'PENDING_APPROVAL'])]])

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    expect(wrapper.text()).toContain('Calendar Wrangler')
    expect(wrapper.text()).toContain('Keeps my calendar tidy')
    // Two pills rendered (RUNNING + PENDING_APPROVAL) via StatusBadge
    expect(wrapper.findAll('.bg-blue-100').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.bg-amber-100').length).toBeGreaterThanOrEqual(1)
  })

  it('emits select with the agent id when the card background is clicked', async () => {
    const agent = makeAgent({ id: 42 })
    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    await wrapper.trigger('click')

    const events = wrapper.emitted('select')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([42])
  })

  it('does NOT double-emit select when clicking the kebab trigger', async () => {
    // The kebab sits inside the card; the card should not fire `select` when
    // its child controls absorb the click.
    const agent = makeAgent({ id: 7 })
    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    const kebabTrigger = wrapper.find('button[aria-label="Actions for Calendar Wrangler"]')
    expect(kebabTrigger.exists()).toBe(true)
    await kebabTrigger.trigger('click')

    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('renders the recent chats section (top 3 tasks)', () => {
    const agent = makeAgent()
    tasksRef.value = [
      makeTask({ id: 1, user_prompt: 'First question', status: 'COMPLETED' }),
      makeTask({ id: 2, user_prompt: 'Second question', status: 'COMPLETED' }),
    ]

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    const prompts = wrapper.findAll('.chat-prompt')
    expect(prompts).toHaveLength(2)
    expect(prompts[0].text()).toBe('First question')
    expect(prompts[1].text()).toBe('Second question')
  })

  it('renders the "+ N more" link when more than 3 tasks exist', () => {
    const agent = makeAgent()
    tasksRef.value = [
      makeTask({ id: 1 }),
      makeTask({ id: 2 }),
      makeTask({ id: 3 }),
      makeTask({ id: 4 }),
      makeTask({ id: 5 }),
    ]

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    expect(wrapper.find('.more-link').exists()).toBe(true)
    expect(wrapper.find('.more-link').text()).toContain('+ 2 more')
  })

  it('shows the task count pill in the footer', () => {
    const agent = makeAgent()
    tasksRef.value = [makeTask({ id: 1 }), makeTask({ id: 2 }), makeTask({ id: 3 })]

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    expect(wrapper.find('.task-count-pill').text()).toBe('3 tasks')
  })

  it('renders an RECENT pill when only completed activity is recent', () => {
    const agent = makeAgent()
    tasksRef.value = [makeTask({ id: 1, status: 'COMPLETED' })]
    activeStatesRef.value = new Map([[1, new Set()]])

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    const recent = wrapper.find('.state-pill[data-pill="RECENT"]')
    expect(recent.exists()).toBe(true)
    expect(recent.text()).toContain('Recently · 1')
  })

  it('renders the idle hint when there are no tasks and no activity', () => {
    const agent = makeAgent()
    tasksRef.value = []
    activeStatesRef.value = new Map()

    const wrapper = mount(DashboardAgentCard, { props: { agent } })

    expect(wrapper.find('.empty-hint').text()).toContain('Idle')
  })

  it('invokes kebab actions via the configured emitters', async () => {
    const agent = makeAgent()
    const wrapper = mount(DashboardAgentCard, {
      props: { agent },
      attachTo: document.body,
    })

    await flushPromises()
    await wrapper.find('button[aria-label="Actions for Calendar Wrangler"]').trigger('click')
    // Now the menu is open — pick the "Settings" action.
    const settingsItem = wrapper.findAll('[role="menuitem"]').find((m) => m.text() === 'Settings')
    expect(settingsItem).toBeDefined()
    await settingsItem!.trigger('click')

    const events = wrapper.emitted('settings')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([1])
    wrapper.unmount()
  })
})
