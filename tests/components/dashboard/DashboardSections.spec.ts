/**
 * DashboardSections — verifies the recency grouping + chip filter.
 *
 * The composable is mocked directly so the test controls the raw
 * `agents` list, the `state.chip` ref, and the `lastTaskByAgent` map
 * (via a stub Pinia store response to `useTaskStore()`). The grouping
 * logic mirrors what the prototype's `groupByRecency` helper did.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'

import DashboardSections from '@/components/dashboard/DashboardSections.vue'
import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'

const agentsRef: Ref<Agent[]> = ref([])
const chipRef = ref<'all' | 'pinned' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'>('all')

let lastTaskByAgent: Map<number, Task> = new Map()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    state: { chip: chipRef, query: { value: '' }, sort: { value: 'activity' } },
    // DashboardAgentCard (rendered transitively via DashboardSection) reads
    // these too. Stub them with sensible empty defaults so the card renders.
    tasks: { value: [] },
    activeStatesByAgent: { value: new Map() },
    kpiCounts: { value: { agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 } },
    filteredAgents: { value: [] },
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
    lastUpdatedAt: { value: null },
    isLoading: { value: false },
    isRefreshing: { value: false },
    setChip: vi.fn(),
    setQuery: vi.fn(),
    setSort: vi.fn(),
  }),
}))

// Replace the real `useTaskStore` so the test owns the lastTaskByAgent map.
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    lastTaskByAgent,
  }),
}))

const todayStart = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()

function isoDaysAgo(days: number): string {
  return new Date(todayStart - days * 24 * 60 * 60 * 1000).toISOString()
}

function makeAgent(id: number, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: `Agent ${id}`,
    description: null,
    system_prompt: null,
    llm_driver_config_id: null,
    max_steps: 5,
    is_active: true,
    tools: [],
    ...overrides,
  }
}

function makeTask(agentId: number, updatedAt: string): Task {
  return {
    id: agentId * 100,
    agent_id: agentId,
    status: 'COMPLETED',
    user_prompt: 'p',
    final_response: null,
    step_count: 0,
    max_steps: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

describe('DashboardSections', () => {
  beforeEach(() => {
    agentsRef.value = []
    lastTaskByAgent = new Map()
    chipRef.value = 'all'
  })

  it('groups agents into Pinned / Today / This Week / Older / Archived (all chip)', async () => {
    agentsRef.value = [
      // Pinned goes first regardless of recency.
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(2, { name: 'Pinned B', is_pinned: true } as Partial<Agent>),
      // Archived goes last regardless of recency.
      makeAgent(3, { name: 'Archived', is_archived: true } as Partial<Agent>),
      // Today.
      makeAgent(4, { name: 'Today' }),
      // This Week (3 days ago).
      makeAgent(5, { name: 'This Week' }),
      // Older (30 days ago).
      makeAgent(6, { name: 'Older' }),
      // No task → Older.
      makeAgent(7, { name: 'No task' }),
    ]

    lastTaskByAgent = new Map([
      [1, makeTask(1, isoDaysAgo(45))], // pinned, recency ignored
      [2, makeTask(2, isoDaysAgo(10))], // pinned, recency ignored
      [4, makeTask(4, new Date(todayStart + 1000).toISOString())], // today
      [5, makeTask(5, isoDaysAgo(3))], // this week
      [6, makeTask(6, isoDaysAgo(30))], // older
    ])

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(5) // Pinned, Today, This Week, Older, Archived

    expect(sections[0].props('title')).toBe('Pinned')
    expect(sections[0].props('agents')).toHaveLength(2)
    expect(sections[1].props('title')).toBe('Today')
    expect(sections[1].props('agents')).toHaveLength(1)
    expect(sections[2].props('title')).toBe('This Week')
    expect(sections[2].props('agents')).toHaveLength(1)
    expect(sections[3].props('title')).toBe('Older')
    expect(sections[3].props('agents')).toHaveLength(2)
    expect(sections[4].props('title')).toBe('Archived')
    expect(sections[4].props('agents')).toHaveLength(1)
  })

  it('renders the Archived section only when chip is "archived"', async () => {
    agentsRef.value = [
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(3, { name: 'Archived', is_archived: true } as Partial<Agent>),
    ]
    lastTaskByAgent = new Map()
    chipRef.value = 'archived'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(1)
    expect(sections[0].props('title')).toBe('Archived')
    expect(sections[0].props('agents')).toHaveLength(1)
  })

  it('renders only Pinned when chip is "pinned"', async () => {
    agentsRef.value = [
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(2, { name: 'Today' }),
    ]
    lastTaskByAgent = new Map([
      [2, makeTask(2, new Date(todayStart + 1000).toISOString())],
    ])
    chipRef.value = 'pinned'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(1)
    expect(sections[0].props('title')).toBe('Pinned')
  })

  it('renders all five sections when chip is RUNNING (state filter is delegated to the cards)', async () => {
    agentsRef.value = [
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(2, { name: 'Archived', is_archived: true } as Partial<Agent>),
      makeAgent(3, { name: 'Today' }),
    ]
    lastTaskByAgent = new Map([
      [3, makeTask(3, new Date(todayStart + 1000).toISOString())],
    ])
    chipRef.value = 'RUNNING'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections.map((s) => s.props('title'))).toEqual([
      'Pinned',
      'Today',
      'This Week',
      'Older',
      'Archived',
    ])
    expect(sections[0].props('agents')).toHaveLength(1)
    expect(sections[4].props('agents')).toHaveLength(1)
  })
})
