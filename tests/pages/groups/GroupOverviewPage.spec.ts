/**
 * GroupOverviewPage — renders 4 stat cards with counts from the detail
 * store, plus a snapshot of the group's agents using `DashboardAgentCard`.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, computed, type Ref } from 'vue'

const routerPush = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMocks = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }

vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMocks,
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

interface DetailMock {
  group: Record<string, unknown> | null
  members: Array<unknown>
  agents: Array<Record<string, unknown>>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
  loading: boolean
  error: string | null
  fetchAgents: ReturnType<typeof vi.fn>
}

function freshDetail(): DetailMock {
  return {
    group: {
      id: 1,
      name: 'Eng',
      description: 'desc',
      principal_id: 10,
      member_count: 5,
      agent_count: 3,
      llm_config_count: 2,
      tool_setting_count: 4,
    },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    loading: false,
    error: null,
    fetchAgents: vi.fn().mockResolvedValue([]),
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => detailStoreMock,
}))

import { reactive } from 'vue'

const updateAgentMock = vi.fn().mockResolvedValue({})
const deleteAgentMock = vi.fn().mockResolvedValue(undefined)

const agentStoreAgents: Array<Record<string, unknown>> = []

const agentStoreMock = {
  // Plain array (not a ref) — Pinia unwraps refs returned from
  // `defineStore`, and the page calls `agentStore.agents.find(...)`
  // expecting an array. Mirroring that with a plain array keeps the
  // test in sync with production usage.
  get agents(): Array<Record<string, unknown>> {
    return agentStoreAgents
  },
  updateAgent: updateAgentMock,
  deleteAgent: deleteAgentMock,
}

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => agentStoreMock,
}))

const allAgentsRef: Ref<Array<Record<string, unknown>>> = ref([])
const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    tasks: ref([]),
    activeStatesByAgent: ref(new Map()),
    agents: computed(() => allAgentsRef.value),
    kpiCounts: computed(() => ({ agents: 0, runningTasks: 0, awaitingTasks: 0, scheduledToday: 0 })),
    filteredAgents: computed(() => []),
    ensureLoaded: ensureLoadedMock,
    refresh: vi.fn(),
    lastUpdatedAt: ref(null),
    isLoading: ref(false),
    isRefreshing: ref(false),
    state: { chip: ref('all'), query: ref(''), sort: ref('activity') },
    setChip: vi.fn(),
    setQuery: vi.fn(),
    setSort: vi.fn(),
  }),
}))

// Stub child components of DashboardAgentCard so the cards render flat
// HTML in the test environment (no nested transitions / portals).
const cardChildStubs = {
  KebabMenu: true,
  Avatar: true,
  OwnerBadge: true,
  StatusBadge: true,
  DashboardScheduledChip: true,
}

import DashboardAgentCard from '@/components/dashboard/DashboardAgentCard.vue'
import GroupOverviewPage from '@/pages/groups/GroupOverviewPage.vue'

describe('GroupOverviewPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    routerPush.mockReset()
    toastMocks.error.mockReset()
    toastMocks.success.mockReset()
    updateAgentMock.mockReset()
    deleteAgentMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockResolvedValue(true)
    ensureLoadedMock.mockReset()
    allAgentsRef.value = []
    agentStoreAgents.length = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders 4 stat cards with the counts from the detail store', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    const text = wrapper.text()
    expect(text).toContain('Members')
    expect(text).toContain('5')
    expect(text).toContain('Agents')
    expect(text).toContain('3')
    expect(text).toContain('Tool settings')
    expect(text).toContain('4')
    expect(text).toContain('LLM drivers')
    expect(text).toContain('2')
  })

  it('falls back to list lengths when counts are missing', () => {
    Object.assign(detailStoreMock, freshDetail())
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    detailStoreMock.members = [{}, {}, {}]
    detailStoreMock.agents = [{ id: 1, name: 'Solo', principal_id: 10 }]
    detailStoreMock.toolSettings = [{}]
    detailStoreMock.llmConfigs = []
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('1')
  })

  it('calls ensureLoaded on mount', async () => {
    mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    await flushPromises()
    expect(ensureLoadedMock).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when the group has no agents', async () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('No agents yet')
  })

  it('renders one DashboardAgentCard per group agent, scoped to the group principal', async () => {
    allAgentsRef.value = [
      { id: 1, name: 'Alpha', principal_id: 10, principal: { id: 10, type: 'group', name: 'Eng', user_id: null, group_id: 1 } },
      { id: 2, name: 'Beta', principal_id: 10, principal: { id: 10, type: 'group', name: 'Eng', user_id: null, group_id: 1 } },
      { id: 3, name: 'Foreign', principal_id: 99, principal: { id: 99, type: 'group', name: 'Other', user_id: null, group_id: 99 } },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    const cards = wrapper.findAllComponents(DashboardAgentCard)
    expect(cards).toHaveLength(2)
    expect(cards[0].props('agent').id).toBe(1)
    expect(cards[1].props('agent').id).toBe(2)
  })

  it('caps the agent list at 6 and shows a "View all" link when more agents exist', async () => {
    allAgentsRef.value = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${i + 1}`,
      principal_id: 10,
      principal: { id: 10, type: 'group', name: 'Eng', user_id: null, group_id: 1 },
    }))
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.findAllComponents(DashboardAgentCard)).toHaveLength(6)
    expect(wrapper.text()).toContain('View all (9)')
  })

  it('lays cards out in a 2-up grid (not 3) to leave room for the sidebar', async () => {
    allAgentsRef.value = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${i + 1}`,
      principal_id: 10,
    }))
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub"></div>' },
        },
      },
    })
    await flushPromises()
    // The grid wraps the agent cards. The class is `grid grid-cols-1
    // sm:grid-cols-2` — 2-up on >= sm, single column on smaller
    // viewports. Asserting on the class string is the most direct
    // way to lock the layout choice.
    const grid = wrapper.find('.grid')
    expect(grid.classes()).toContain('grid-cols-1')
    expect(grid.classes()).toContain('sm:grid-cols-2')
    expect(grid.classes()).not.toContain('lg:grid-cols-3')
  })

  it('navigates to /agents/:id when a card emits select', async () => {
    allAgentsRef.value = [
      { id: 42, name: 'Helper', principal_id: 10, principal: { id: 10, type: 'group', name: 'Eng', user_id: null, group_id: 1 } },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    const card = wrapper.findComponent(DashboardAgentCard)
    card.vm.$emit('select', 42)
    expect(routerPush).toHaveBeenCalledWith({ name: 'agent', params: { id: '42' } })
  })

  it('wires favorite/archive/delete handlers onto each card', async () => {
    allAgentsRef.value = [
      { id: 42, name: 'Helper', principal_id: 10, is_favorite: false, is_archived: false },
    ]
    agentStoreAgents.push(...allAgentsRef.value)
    updateAgentMock.mockResolvedValueOnce({ is_favorite: true })
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    const card = wrapper.findComponent(DashboardAgentCard)
    card.vm.$emit('favorite', 42)
    await flushPromises()
    expect(updateAgentMock).toHaveBeenCalledWith(42, { is_favorite: true })
    expect(toastMocks.success).toHaveBeenCalledWith('Added to favorites')
  })

  it('navigates to agent-settings when settings is emitted', async () => {
    allAgentsRef.value = [
      { id: 42, name: 'Helper', principal_id: 10 },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], emits: ['select', 'run-new-task', 'settings', 'favorite', 'archive', 'delete'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    const card = wrapper.findComponent(DashboardAgentCard)
    card.vm.$emit('settings', 42)
    expect(routerPush).toHaveBeenCalledWith({ name: 'agent-settings', params: { id: '42' } })
  })
})