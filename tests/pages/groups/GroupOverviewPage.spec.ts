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

const authUserMock = { id: 1, is_admin: false }
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authUserMock }),
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

const { createDialogOpenMock } = vi.hoisted(() => ({ createDialogOpenMock: vi.fn() }))
vi.mock('@/stores/createAgentDialog', () => ({
  useCreateAgentDialogStore: () => ({ open: createDialogOpenMock }),
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
const setFavoriteMock = vi.fn().mockResolvedValue({})
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
  setFavorite: setFavoriteMock,
  deleteAgent: deleteAgentMock,
}

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => agentStoreMock,
}))

const allAgentsRef: Ref<Array<Record<string, unknown>>> = ref([])
const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)

const { compareAgentsMock, buildTaskCountByAgentMock, taskStoreTasksArr, lastTaskByAgentMap } = vi.hoisted(() => {
  const compareAgentsMock = vi.fn(() => 0)
  const buildTaskCountByAgentMock = vi.fn(() => new Map<number, number>())
  const taskStoreTasksArr: Array<Record<string, unknown>> = []
  const lastTaskByAgentMap = new Map<number, Record<string, unknown>>()
  return { compareAgentsMock, buildTaskCountByAgentMock, taskStoreTasksArr, lastTaskByAgentMap }
})

vi.mock('@/composables/useDashboardData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useDashboardData')>()
  return {
    ...actual,
    compareAgents: compareAgentsMock,
    buildTaskCountByAgent: buildTaskCountByAgentMock,
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
  }
})

const taskStoreTasksRef: Ref<Array<Record<string, unknown>>> = ref(taskStoreTasksArr)
const taskStoreMock = {
  get tasks(): Array<Record<string, unknown>> {
    return taskStoreTasksRef.value
  },
  get lastTaskByAgent(): ReadonlyMap<number, Record<string, unknown>> {
    return lastTaskByAgentMap
  },
}

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
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
import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'

describe('GroupOverviewPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    routerPush.mockReset()
    toastMocks.error.mockReset()
    toastMocks.success.mockReset()
    updateAgentMock.mockReset()
    setFavoriteMock.mockReset()
    deleteAgentMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockResolvedValue(true)
    createDialogOpenMock.mockReset()
    ensureLoadedMock.mockReset()
    compareAgentsMock.mockReset()
    compareAgentsMock.mockImplementation(() => 0)
    buildTaskCountByAgentMock.mockReset()
    buildTaskCountByAgentMock.mockImplementation(() => new Map())
    allAgentsRef.value = []
    agentStoreAgents.length = 0
    taskStoreTasksArr.length = 0
    lastTaskByAgentMap.clear()
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

  it('does not render the "High-level summary" subline under the heading', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    expect(wrapper.text()).not.toContain('High-level summary')
    expect(wrapper.text()).not.toContain("this group's resources")
  })

  it('lays stat cards in a 4-up row on desktop, 2-up on tablet, 1-up on mobile', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    // The first .grid is the stat-card row (the agents section is
    // either a second .grid or absent when there are no agents).
    const grids = wrapper.findAll('.grid')
    const statGrid = grids[0]
    expect(statGrid).toBeDefined()
    expect(statGrid.classes()).toContain('grid-cols-1')
    expect(statGrid.classes()).toContain('md:grid-cols-2')
    expect(statGrid.classes()).toContain('lg:grid-cols-4')
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

  it('lays stat cards in a 4-up row on desktop, 2-up on tablet, 1-up on mobile', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    // The first .grid is the stat-card row (the agents section is
    // either a second .grid or empty when there are no agents).
    const statGrid = wrapper.findAll('.grid')[0]
    expect(statGrid).toBeDefined()
    expect(statGrid.classes()).toContain('grid-cols-1')
    expect(statGrid.classes()).toContain('md:grid-cols-2')
    expect(statGrid.classes()).toContain('lg:grid-cols-4')
  })

  it('lays agent cards out in a 2-up grid (not 3) to leave room for the sidebar', async () => {
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
    // The first .grid is the stat-card row, the second is the
    // agent-card grid. The group sidebar (200px on lg+) makes a
    // 3-up grid too cramped — assert the agent grid stays 2-up.
    const grids = wrapper.findAll('.grid')
    const agentGrid = grids[grids.length - 1]
    expect(agentGrid.classes()).toContain('grid-cols-1')
    expect(agentGrid.classes()).toContain('sm:grid-cols-2')
    expect(agentGrid.classes()).not.toContain('lg:grid-cols-3')
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
    setFavoriteMock.mockResolvedValueOnce({ is_favorite: true })
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
    // Plan A: PATCH /agents/{id} no longer accepts `is_favorite`. The
    // card's favorite event routes through `agentStore.setFavorite`
    // (POST/DELETE /agents/{id}/favorite + re-fetch).
    expect(setFavoriteMock).toHaveBeenCalledWith(42, true)
    expect(updateAgentMock).not.toHaveBeenCalled()
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

  it('does not render a picture picker on the overview (it lives on the settings page)', async () => {
    authUserMock.is_admin = true
    authUserMock.id = 1
    Object.assign(detailStoreMock, freshDetail())
    detailStoreMock.group = { id: 1, name: 'Eng', my_role: 'owner', principal_id: 10 }
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    await flushPromises()
    expect(wrapper.find('[data-testid="open-picture-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="profile-picture-section"]').exists()).toBe(false)
  })

  it('renders a "+ New agent" CTA inside the empty state when the group has a principal_id', () => {
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    allAgentsRef.value = []
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    const cta = wrapper.findAll('button').find((b) => b.text().includes('New agent'))
    expect(cta).toBeTruthy()
  })

  it('hides the empty-state CTA before the group loads', () => {
    detailStoreMock.group = null
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    const cta = wrapper.findAll('button').find((b) => b.text().includes('New agent'))
    expect(cta).toBeUndefined()
  })

  it('clicking the empty-state CTA opens the create-agent dialog with the group principal', async () => {
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    allAgentsRef.value = []
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true, DashboardAgentCard: true } } })
    const cta = wrapper.findAll('button').find((b) => b.text().includes('New agent'))
    expect(cta).toBeTruthy()
    await cta!.trigger('click')
    expect(createDialogOpenMock).toHaveBeenCalledWith('choice', 10)
  })

  it('does not render the empty-state CTA once the group has agents', () => {
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    allAgentsRef.value = [{ id: 1, name: 'A', principal_id: 10 }]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div />' },
        },
      },
    })
    // The page now renders a card grid, not the empty-state CTA.
    expect(wrapper.findAll('button').find((b) => b.text().includes('New agent'))).toBeUndefined()
  })

  it('renders a Favorites section ahead of the Agents section when at least one group agent is favourited', async () => {
    allAgentsRef.value = [
      { id: 1, name: 'Fav One', principal_id: 10, is_favorite: true },
      { id: 2, name: 'Plain', principal_id: 10, is_favorite: false },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Favorites')
    const cards = wrapper.findAllComponents(DashboardAgentCard)
    expect(cards).toHaveLength(2)
    // Card order: favourite first (Favorites section), then non-favourite.
    expect(cards[0].props('agent').id).toBe(1)
    expect(cards[1].props('agent').id).toBe(2)
    // The "Favorites" heading lives in a section that precedes the Agents section.
    const favSection = wrapper.findAll('section').find((s) => s.text().startsWith('Favorites'))
    const agentsSection = wrapper.findAll('section').find((s) => s.text().startsWith('Agents'))
    expect(favSection).toBeDefined()
    expect(agentsSection).toBeDefined()
    expect(wrapper.vm.$el.querySelectorAll('section').length).toBeGreaterThanOrEqual(2)
  })

  it('hides the Favorites section when no group agent is favourited', async () => {
    allAgentsRef.value = [
      { id: 1, name: 'Plain', principal_id: 10, is_favorite: false },
      { id: 2, name: 'Also Plain', principal_id: 10 },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub"></div>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Favorites')
  })

  it('does not cap the Favorites section at 6', async () => {
    allAgentsRef.value = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      name: `Fav ${i + 1}`,
      principal_id: 10,
      is_favorite: true,
    }))
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.findAllComponents(DashboardAgentCard)).toHaveLength(8)
    // No "View all" link — the favourites section is unbounded.
    expect(wrapper.text()).not.toContain('View all')
  })

  it('renders a Sort dropdown next to the Agents heading and forwards changes to the comparator', async () => {
    compareAgentsMock.mockClear()
    allAgentsRef.value = [
      { id: 1, name: 'Alpha', principal_id: 10 },
      { id: 2, name: 'Bravo', principal_id: 10 },
      { id: 3, name: 'Charlie', principal_id: 10 },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub" :data-agent-id="agent.id"></div>' },
        },
      },
    })
    await flushPromises()
    const sortSelect = wrapper.find('select[aria-label="Sort agents"]')
    expect(sortSelect.exists()).toBe(true)
    expect(sortSelect.element.value).toBe('activity')
    expect(compareAgentsMock).toHaveBeenCalled()
    const lastCall = compareAgentsMock.mock.calls[compareAgentsMock.mock.calls.length - 1]
    expect(lastCall[2]).toBe('activity')

    await sortSelect.setValue('name')
    expect(compareAgentsMock.mock.calls.at(-1)?.[2]).toBe('name')

    await sortSelect.setValue('tasks')
    expect(compareAgentsMock.mock.calls.at(-1)?.[2]).toBe('tasks')
  })

  it('does not render the Sort dropdown when the only agents are favourites', async () => {
    allAgentsRef.value = [
      { id: 1, name: 'Fav', principal_id: 10, is_favorite: true },
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub"></div>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.find('select[aria-label="Sort agents"]').exists()).toBe(false)
  })

  it('keeps the View-all link count on the total group agents, not on what fits on the snapshot', async () => {
    allAgentsRef.value = [
      { id: 1, name: 'Fav', principal_id: 10, is_favorite: true },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: i + 2,
        name: `Plain ${i + 2}`,
        principal_id: 10,
        is_favorite: false,
      })),
    ]
    const wrapper = mount(GroupOverviewPage, {
      global: {
        stubs: {
          Icon: true,
          DashboardAgentCard: { name: 'DashboardAgentCard', props: ['agent'], template: '<div class="card-stub"></div>' },
        },
      },
    })
    await flushPromises()
    // 1 favourite (unbounded) + 6 non-favourites (capped) = 7 cards.
    expect(wrapper.findAllComponents(DashboardAgentCard)).toHaveLength(7)
    expect(wrapper.text()).toContain('View all (9)')
  })
})