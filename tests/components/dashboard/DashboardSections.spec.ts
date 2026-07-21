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
import { ref, computed, type Ref } from 'vue'

import DashboardSections from '@/components/dashboard/DashboardSections.vue'
import type { Agent } from '@/types/agent'
import type { Task } from '@/types/task'

const agentsRef: Ref<Agent[]> = ref([])
const chipRef: Ref<'all' | 'pinned' | 'favorites' | 'RUNNING' | 'AWAITING' | 'SCHEDULED' | 'archived'> = ref('all')
const queryRef: Ref<string> = ref('')
const sortRef: Ref<'activity' | 'name' | 'created' | 'tasks'> = ref('activity')

let lastTaskByAgent: Map<number, Task> = new Map()

/**
 * Faithful mock: the component reads `filteredAgents` from
 * `useDashboardData()`, which is a computed that applies chip / query /
 * sort. To exercise the component realistically, this mock derives
 * filteredAgents from agentsRef + chipRef + sortRef using the same
 * comparator the real composable does. (Query is empty in these specs.)
 */
function deriveFiltered(): Agent[] {
  const needle = queryRef.value.trim().toLowerCase()
  let list = agentsRef.value.filter((a) => {
    if (needle === '') return true
    if (a.name.toLowerCase().includes(needle)) return true
    return false
  })
  if (chipRef.value === 'pinned') list = list.filter((a) => a.is_pinned === true)
  else if (chipRef.value === 'favorites') list = list.filter((a) => a.is_favorite === true)
  else if (chipRef.value === 'archived') list = list.filter((a) => a.is_archived === true)
  if (sortRef.value === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name))
  else if (sortRef.value === 'tasks') {
    const counts = new Map<number, number>()
    for (const t of lastTaskByAgent.values()) counts.set(t.agent_id, (counts.get(t.agent_id) ?? 0) + 1)
    list = list.slice().sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
  } else if (sortRef.value === 'activity') {
    list = list.slice().sort((a, b) => {
      const aLast = lastTaskByAgent.get(a.id)?.updated_at
      const bLast = lastTaskByAgent.get(b.id)?.updated_at
      if (aLast === undefined && bLast === undefined) return 0
      if (aLast === undefined) return 1
      if (bLast === undefined) return -1
      return new Date(bLast).getTime() - new Date(aLast).getTime()
    })
  }
  return list
}

// A real Ref so Vue's template auto-unwrapping works (`filteredAgents.value`
// in <script setup> resolves correctly, `filteredAgents` in the template
// resolves to the array).
const filteredAgentsRef = computed<Agent[]>(() => deriveFiltered())

// Mirrors the `pinnedVisible` / `archivedVisible` computeds the real
// composable exposes — same source (`agentsRef`), same tolerates-undefined
// semantics. The component no longer re-implements these locally.
const pinnedVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => (a as { is_pinned?: boolean }).is_pinned === true),
)
const favoritesVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => a.is_favorite === true),
)
const archivedVisible = computed<boolean>(() =>
  agentsRef.value.some((a) => (a as { is_archived?: boolean }).is_archived === true),
)

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    filteredAgents: filteredAgentsRef,
    state: { chip: chipRef, query: queryRef, sort: sortRef },
    tasks: { value: [] },
    activeStatesByAgent: { value: new Map() },
    kpiCounts: { value: { agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 } },
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
    lastUpdatedAt: { value: null },
    isLoading: { value: false },
    isRefreshing: { value: false },
    pinnedVisible,
    favoritesVisible,
    archivedVisible,
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
    queryRef.value = ''
    sortRef.value = 'activity'
  })

  /** Helper: seed agents. `filteredAgentsRef` is a `computed` derived
   * from `agentsRef` + the chip / query / sort refs — we don't touch it
   * directly. The visibility gate (Pinned / Archived) reads `agentsRef`;
   * the rendered grid reads `filteredAgentsRef`. */
  function seed(...list: Agent[]): void {
    agentsRef.value = list
  }

  it('groups agents into Pinned / Favorites / Today / This Week / Older / Archived (all chip)', async () => {
    seed(
      makeAgent(1, { name: 'Pinned A', is_pinned: true }),
      makeAgent(2, { name: 'Pinned B', is_pinned: true }),
      makeAgent(3, { name: 'Favorite', is_favorite: true }),
      makeAgent(4, { name: 'Today' }),
      makeAgent(5, { name: 'This Week' }),
      makeAgent(6, { name: 'Older' }),
      makeAgent(7, { name: 'No task, created today', created_at: new Date(todayStart + 500).toISOString() }),
      makeAgent(8, { name: 'No task, created 10d', created_at: isoDaysAgo(10) }),
      makeAgent(9, { name: 'Archived', is_archived: true }),
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
    expect(sections).toHaveLength(6)

    expect(sections[0].props('title')).toBe('Pinned')
    expect(sections[0].props('agents')).toHaveLength(2)
    expect(sections[1].props('title')).toBe('Favorites')
    expect(sections[1].props('agents')).toHaveLength(1)
    expect(sections[2].props('title')).toBe('Today')
    expect(sections[2].props('agents')).toHaveLength(2)
    expect(sections[3].props('title')).toBe('This Week')
    expect(sections[3].props('agents')).toHaveLength(1)
    expect(sections[4].props('title')).toBe('Older')
    expect(sections[4].props('agents')).toHaveLength(2)
    expect(sections[5].props('title')).toBe('Archived')
    expect(sections[5].props('agents')).toHaveLength(1)
  })

  it('places a favorited pinned agent in Favorites rather than Pinned', async () => {
    seed(
      makeAgent(1, { name: 'Favorite and pinned', is_favorite: true, is_pinned: true }),
      makeAgent(2, { name: 'Pinned only', is_pinned: true }),
    )

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections.map((section) => section.props('title'))).toEqual(['Pinned', 'Favorites'])
    expect(sections[0].props('agents').map((agent: Agent) => agent.id)).toEqual([2])
    expect(sections[1].props('agents').map((agent: Agent) => agent.id)).toEqual([1])
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
    // Simulate "operator typed 'alpha' into the search box". The faithful
    // mock derives filteredAgents from agentsRef + queryRef, so setting
    // queryRef.value = 'Alpha' surfaces only the alpha agent. The
    // component groups filteredAgents, so only 'alpha' should render.
    const alpha = makeAgent(1, { name: 'Alpha' })
    const beta = makeAgent(2, { name: 'Beta' })
    seed(alpha, beta)
    queryRef.value = 'Alpha'
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

  it('collapses to a single grid when sort !== "activity"', async () => {
    seed(
      makeAgent(1, { name: 'Bravo', created_at: new Date(todayStart + 100).toISOString() }),
      makeAgent(2, { name: 'Alpha', created_at: new Date(todayStart + 200).toISOString() }),
      makeAgent(3, { name: 'Charlie', created_at: isoDaysAgo(20) }),
    )
    sortRef.value = 'name'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(1)
    expect(sections[0].props('title')).toContain('sorted by Name')
    expect(sections[0].props('agents').map((a: Agent) => a.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('collapses with a "Task count" sort showing counts as sort key in heading', async () => {
    seed(makeAgent(1, { name: 'A' }), makeAgent(2, { name: 'B' }))
    sortRef.value = 'tasks'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    expect(sections).toHaveLength(1)
    expect(sections[0].props('title')).toContain('sorted by Task count')
  })

  it('forces bucketed grid when chip is "pinned" even with a non-activity sort', async () => {
    seed(
      makeAgent(1, { name: 'Pinned A', is_pinned: true } as Partial<Agent>),
      makeAgent(2, { name: 'Pinned B', is_pinned: true } as Partial<Agent>),
      makeAgent(3, { name: 'Other', created_at: new Date(todayStart + 100).toISOString() }),
    )
    // Mark every loaded agent as pinned so the gating gate sees a flag.
    chipRef.value = 'pinned'
    sortRef.value = 'name'

    const wrapper = mount(DashboardSections)
    await flushPromises()

    const sections = wrapper.findAllComponents({ name: 'DashboardSection' })
    // Pinned section always wins over the collapsed view.
    expect(sections[0].props('title')).toBe('Pinned')
  })

  it('forwards section actions to the page', async () => {
    seed(makeAgent(7, { name: 'Alpha' }))
    const wrapper = mount(DashboardSections)
    await flushPromises()

    const section = wrapper.findComponent({ name: 'DashboardSection' })
    await section.vm.$emit('runNewTask', 7)
    await section.vm.$emit('settings', 7)
    await section.vm.$emit('favorite', 7)
    await section.vm.$emit('archive', 7)
    await section.vm.$emit('delete', 7)
    await section.vm.$emit('taskOpen', 42)

    expect(wrapper.emitted('runNewTask')).toEqual([[7]])
    expect(wrapper.emitted('settings')).toEqual([[7]])
    expect(wrapper.emitted('favorite')).toEqual([[7]])
    expect(wrapper.emitted('archive')).toEqual([[7]])
    expect(wrapper.emitted('delete')).toEqual([[7]])
    expect(wrapper.emitted('taskOpen')).toEqual([[42]])
  })
})
