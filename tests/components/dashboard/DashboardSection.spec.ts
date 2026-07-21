/**
 * DashboardSection — verifies the title + count header, the grid rendering,
 * and that selecting a card routes via the router with the agent id.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'

import DashboardSection from '@/components/dashboard/DashboardSection.vue'
import type { Agent } from '@/types/agent'

const tasksRef: Ref<unknown[]> = ref([])
const activeStatesRef: Ref<Map<number, Set<string>>> = ref(new Map())

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    tasks: tasksRef,
    activeStatesByAgent: activeStatesRef,
    agents: { value: [] },
    kpiCounts: { value: { agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 } },
    filteredAgents: { value: [] },
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
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

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>', props: ['to'] },
}))

function makeAgent(id: number, name: string): Agent {
  return {
    id,
    name,
    description: null,
    system_prompt: null,
    llm_driver_config_id: null,
    max_steps: 5,
    is_active: true,
    tools: [],
  }
}

describe('DashboardSection', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders the title and the agent count label', () => {
    const agents: Agent[] = [makeAgent(1, 'Alpha'), makeAgent(2, 'Beta')]
    const wrapper = mount(DashboardSection, {
      props: { title: 'Today', agents },
    })

    expect(wrapper.find('.section-title').text()).toBe('Today')
    expect(wrapper.find('.section-count').text()).toBe('· 2 agents')
  })

  it('renders a single agent with singular label', () => {
    const wrapper = mount(DashboardSection, {
      props: { title: 'Pinned', agents: [makeAgent(1, 'Solo')] },
    })
    expect(wrapper.find('.section-count').text()).toBe('· 1 agent')
  })

  it('renders a card for each agent', () => {
    const agents: Agent[] = [
      makeAgent(1, 'Alpha'),
      makeAgent(2, 'Beta'),
      makeAgent(3, 'Gamma'),
    ]
    const wrapper = mount(DashboardSection, {
      props: { title: 'This Week', agents },
    })
    const cards = wrapper.findAllComponents({ name: 'DashboardAgentCard' })
    expect(cards).toHaveLength(3)
  })

  it('renders the empty state when no agents are passed', () => {
    const wrapper = mount(DashboardSection, {
      props: { title: 'Older', agents: [] },
    })
    expect(wrapper.text()).toContain('No agents in this section')
  })

  it('routes to the agent detail page when a card emits select', async () => {
    const agents: Agent[] = [makeAgent(42, 'Forty-Two')]
    const wrapper = mount(DashboardSection, {
      props: { title: 'Today', agents },
    })
    await flushPromises()

    const card = wrapper.findComponent({ name: 'DashboardAgentCard' })
    await card.vm.$emit('select', 42)
    await flushPromises()

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: '42' } })
  })

  // Recent-task rows no longer emit a `taskOpen` event — the card
  // renders a `<router-link>` directly so navigation is the router's
  // job, not the page handler's. The forwarding contract here covers
  // the kebab-driven actions only.
  it('forwards card emits to the parent (runNewTask, settings, favorite, archive, delete)', async () => {
    const agents: Agent[] = [makeAgent(7, 'Alpha')]
    const wrapper = mount(DashboardSection, {
      props: { title: 'Today', agents },
    })
    await flushPromises()

    const card = wrapper.findComponent({ name: 'DashboardAgentCard' })
    await card.vm.$emit('runNewTask', 7)
    await card.vm.$emit('settings', 7)
    await card.vm.$emit('favorite', 7)
    await card.vm.$emit('archive', 7)
    await card.vm.$emit('delete', 7)

    expect(wrapper.emitted('runNewTask')).toEqual([[7]])
    expect(wrapper.emitted('settings')).toEqual([[7]])
    expect(wrapper.emitted('favorite')).toEqual([[7]])
    expect(wrapper.emitted('archive')).toEqual([[7]])
    expect(wrapper.emitted('delete')).toEqual([[7]])
    expect(wrapper.emitted('taskOpen')).toBeFalsy()
  })
})
