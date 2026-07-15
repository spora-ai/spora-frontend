/**
 * DashboardSections — verifies the recency grouping and empty-bucket
 * drop. The composable is mocked so the test owns both the unfiltered
 * `agents` (used for the Pinned / Archived visibility gate) and the
 * already-filtered `filteredAgents` (what the component groups).
 * Chip + query + sort filtering is now applied upstream in
 * `useDashboardData.filteredAgents`; DashboardSections no longer
 * applies it itself, so the chip-ref / query-ref state stubs are gone.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'

import DashboardSections from '@/components/dashboard/DashboardSections.vue'
import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'

const agentsRef: Ref<Agent[]> = ref([])
const filteredAgentsRef: Ref<Agent[]> = ref([])

let lastTaskByAgent: Map<number, Task> = new Map()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    filteredAgents: filteredAgentsRef,
    state: { chip: { value: 'all' }, query: { value: '' }, sort: { value: 'activity' } },
    tasks: { value: [] },
    activeStatesByAgent: { value: new Map() },
    kpiCounts: { value: { agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 } },
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
    filteredAgentsRef.value = []
    lastTaskByAgent = new Map()
  })

  /** Helper: seed the same agents into both refs so the visibility gate
   * has the same data the component groups from. */
  function seed(...list: Agent[]): void {
    agentsRef.value = list
    filteredAgentsRef.value = list
  }

  it('groups agents into Pinned / Today / This Week / Older / Archived (all chip)', async () => {
    seed(
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(2, { name: 'Pinned B', is_pinned: true } as Partial<Agent>),
      makeAgent(3, { name: 'Archived', is_archived: true } as Partial<Agent>),
      makeAgent(4, { name: 'Today' }),
      makeAgent(5, { name: 'This Week' }),
      makeAgent(6, { name: 'Older' }),
      makeAgent(7, { name: 'No task, created today', created_at: new Date(todayStart + 500).toISOString() }),
      makeAgent(8, { name: 'No task, created 10d', created_at: isoDaysAgo(10) }),
    )

    lastTaskByAgent = new Map([
      [1, makeTask(1, isoDaysAgo(45))],
      [2, makeTask(2, isoDaysAgo(10))],
      [4, makeTask(4, new Date(todayStart + 1000).toISOString())],
      [5, makeTask(5, isoDaysAgo(3))],
      [6, makeTask(6, isoDaysAgo(30))],
    ])

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(5)

    expect(sections[0].props('title')).toBe('Pinned')
    expect(sections[0].props('agents')).toHaveLength(2)
    expect(sections[1].props('title')).toBe('Today')
    expect(sections[1].props('agents')).toHaveLength(2)
    expect(sections[2].props('title')).toBe('This Week')
    expect(sections[2].props('agents')).toHaveLength(1)
    expect(sections[3].props('title')).toBe('Older')
    expect(sections[3].props('agents')).toHaveLength(2)
    expect(sections[4].props('title')).toBe('Archived')
    expect(sections[4].props('agents')).toHaveLength(1)
  })

  it('routes a no-task agent to its created_at bucket (not always Today)', async () => {
    seed(
      makeAgent(1, { name: 'Created 4 days ago, no task yet', created_at: isoDaysAgo(4) }),
      makeAgent(2, { name: 'Created 90 days ago, no task yet', created_at: isoDaysAgo(90) }),
    )

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections.map((s) => s.props('title'))).toEqual(['This Week', 'Older'])
    expect(sections[0].props('agents')).toHaveLength(1)
    expect(sections[1].props('agents')).toHaveLength(1)
  })

  it('drops empty recency buckets (no "Today — 0 agents" headings)', async () => {
    seed(
      makeAgent(1, { name: 'Only Older', created_at: isoDaysAgo(30) }),
    )

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections.map((s) => s.props('title'))).toEqual(['Older'])
  })

  it('reflects the filteredAgents list: search hides the matching agent from every bucket', async () => {
    // The chip / query / sort pass happens in `useDashboardData.filteredAgents`.
    // This test simulates "operator typed 'alpha' into the search box and
    // only that agent passed the filter": filteredAgentsRef is just the
    // alpha agent, agentsRef is the full list. DashboardSections groups
    // filteredAgents, so only 'alpha' should appear.
    const alpha = makeAgent(1, { name: 'Alpha' })
    const beta = makeAgent(2, { name: 'Beta' })
    agentsRef.value = [alpha, beta]
    filteredAgentsRef.value = [alpha]
    lastTaskByAgent = new Map([
      [1, makeTask(1, new Date(todayStart + 1000).toISOString())],
      [2, makeTask(2, new Date(todayStart + 1000).toISOString())],
    ])

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(1)
    expect(sections[0].props('title')).toBe('Today')
    expect(sections[0].props('agents')).toHaveLength(1)
    expect(sections[0].props('agents')[0].name).toBe('Alpha')
  })

  it('hides the Pinned and Archived section headings when no agent has the flag (even with other buckets populated)', async () => {
    seed(
      makeAgent(1, { name: 'A', created_at: new Date(todayStart + 500).toISOString() }),
      makeAgent(2, { name: 'B', created_at: new Date(todayStart + 500).toISOString() }),
    )

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections.map((s) => s.props('title'))).toEqual(['Today'])
  })
})
