/**
 * DashboardPage — thin shell that composes the Phase-2 subcomponents.
 *
 * Tests focus on the shell's behaviour: mount-time fetch via
 * `useDashboardData().ensureLoaded`, the navbar + subcomponent tree, the
 * two empty-state variants, the create-dialog trigger, and the kebab
 * action handlers (settings / archive / delete). Subcomponent behaviour
 * (KPIs, sections, toolbar) is covered by the per-component specs under
 * tests/components/dashboard/.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

interface DashboardAgent {
  id: number
  name: string
  tools: unknown[]
  is_archived?: boolean
  is_favorite?: boolean
}

const agentsRef = ref<DashboardAgent[]>([])
const filteredRef = ref<DashboardAgent[]>([])
const isLoadingRef = ref(false)
const ensureLoadedMock = vi.fn()
const refreshMock = vi.fn()
const setChipMock = vi.fn()
const setQueryMock = vi.fn()
const setSortMock = vi.fn()
const warmScheduledRunsMock = vi.fn()
const updateAgentMock = vi.fn<(id: number, data: Partial<Pick<DashboardAgent, 'is_archived' | 'is_favorite'>>) => Promise<DashboardAgent>>()
const deleteAgentMock = vi.fn<(id: number) => Promise<void>>()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    filteredAgents: filteredRef,
    isLoading: isLoadingRef,
    lastUpdatedAt: ref(null),
    refresh: refreshMock,
    ensureLoaded: ensureLoadedMock,
    warmScheduledRuns: warmScheduledRunsMock,
    setChip: setChipMock,
    setQuery: setQueryMock,
    setSort: setSortMock,
    pinnedVisible: computed(() => false),
    favoritesVisible: computed(() => agentsRef.value.some((agent) => agent.is_favorite === true)),
    archivedVisible: computed(() => agentsRef.value.some((agent) => agent.is_archived === true)),
    state: {
      chip: ref('all'),
      query: ref(''),
      sort: ref('activity'),
    },
    kpiCounts: computed(() => ({
      agents: agentsRef.value.length,
      runningTasks: 0,
      awaitingTasks: 0,
      scheduledToday: 0,
    })),
  }),
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get agents(): DashboardAgent[] {
      return agentsRef.value
    },
    updateAgent: updateAgentMock,
    deleteAgent: deleteAgentMock,
  }),
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    info: vi.fn(),
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: vi.fn(),
  }),
}))

const confirmMock = vi.fn<(msg: string, title?: string, actionLabel?: string) => Promise<boolean>>()
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

const DashboardHeaderStub = { name: 'DashboardHeader', template: '<div class="header-stub" />' }
const DashboardKpiStripStub = { name: 'DashboardKpiStrip', template: '<div class="kpi-stub" />' }
const DashboardToolbarStub = { name: 'DashboardToolbar', template: '<div class="toolbar-stub" />' }
const DashboardFilterChipsStub = { name: 'DashboardFilterChips', template: '<div class="chips-stub" />' }
const DashboardSectionsStub = {
  name: 'DashboardSections',
  emits: ['run-new-task', 'settings', 'favorite', 'archive', 'delete'],
  template: '<div class="sections-stub" />',
}
const GlobalNavbarStub = { name: 'GlobalNavbar', template: '<div class="navbar-stub" />' }

import DashboardPage from '@/pages/DashboardPage.vue'

beforeEach(() => {
  agentsRef.value = []
  filteredRef.value = []
  isLoadingRef.value = false
  ensureLoadedMock.mockReset()
  refreshMock.mockReset()
  setChipMock.mockReset()
  setQueryMock.mockReset()
  setSortMock.mockReset()
  warmScheduledRunsMock.mockReset()
  pushMock.mockReset()
  toastSuccessMock.mockReset()
  toastErrorMock.mockReset()
  updateAgentMock.mockReset()
  updateAgentMock.mockImplementation(async (id, data) => {
    const agent = agentsRef.value.find((candidate) => candidate.id === id)
    if (!agent) throw new Error(`Agent ${id} not found`)
    return { ...agent, ...data }
  })
  deleteAgentMock.mockReset()
  deleteAgentMock.mockResolvedValue(undefined)
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

describe('DashboardPage', () => {
  it('renders the global navbar', () => {
    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    expect(wrapper.find('.navbar-stub').exists()).toBe(true)
  })

  it('renders the dashboard subcomponent tree (header, KPI strip, toolbar, chips, sections)', () => {
    agentsRef.value = [{ id: 1, name: 'Alpha', tools: [] }]
    filteredRef.value = agentsRef.value
    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    expect(wrapper.find('.header-stub').exists()).toBe(true)
    expect(wrapper.find('.kpi-stub').exists()).toBe(true)
    expect(wrapper.find('.toolbar-stub').exists()).toBe(true)
    expect(wrapper.find('.chips-stub').exists()).toBe(true)
    expect(wrapper.find('.sections-stub').exists()).toBe(true)
  })

  it('triggers ensureLoaded on mount', async () => {
    mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()
    expect(ensureLoadedMock).toHaveBeenCalledOnce()
  })

  it('shows the no-agents empty state when agents is empty and not loading', async () => {
    agentsRef.value = []
    filteredRef.value = []
    isLoadingRef.value = false

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          EmptyState: { name: 'EmptyState', template: '<div class="empty" />', props: ['title', 'description'] },
          RouterLink: true,
        },
      },
    })
    await flushPromises()
    expect(wrapper.find('.empty').exists()).toBe(true)
  })

  it('hides the empty state once agents are loaded', async () => {
    agentsRef.value = [{ id: 1, name: 'Alpha', tools: [] }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          EmptyState: { name: 'EmptyState', template: '<div class="empty" />', props: ['title', 'description'] },
          RouterLink: true,
        },
      },
    })
    await flushPromises()
    expect(wrapper.find('.empty').exists()).toBe(false)
  })

  it('shows the filter-empty state when agents exist but the filter matches none', async () => {
    agentsRef.value = [{ id: 1, name: 'Alpha', tools: [] }]
    filteredRef.value = [] // filter matches nothing
    isLoadingRef.value = false

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          EmptyState: { name: 'EmptyState', template: '<div class="empty" />', props: ['title', 'description', 'actionLabel'], emits: ['action'] },
          RouterLink: true,
        },
      },
    })
    await flushPromises()
    expect(wrapper.find('.empty').exists()).toBe(true)
  })

  it('triggers warmScheduledRuns on mount', async () => {
    mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()
    expect(warmScheduledRunsMock).toHaveBeenCalledOnce()
  })

  it('routes to agent-settings on kebab settings emit', async () => {
    agentsRef.value = [{ id: 7, name: 'Alpha', tools: [] }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()

    const sections = wrapper.findComponent({ name: 'DashboardSections' })
    await sections.vm.$emit('settings', 7)
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith({ name: 'agent-settings', params: { id: '7' } })
  })

  it('routes to the agent detail page on kebab run-new-task emit', async () => {
    agentsRef.value = [{ id: 7, name: 'Alpha', tools: [] }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()

    const sections = wrapper.findComponent({ name: 'DashboardSections' })
    await sections.vm.$emit('run-new-task', 7)
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: '7' } })
  })

  it('toggles archive through the agent store and shows a success toast', async () => {
    agentsRef.value = [{ id: 7, name: 'Alpha', tools: [], is_archived: false }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()

    const sections = wrapper.findComponent({ name: 'DashboardSections' })
    await sections.vm.$emit('archive', 7)
    await flushPromises()

    expect(updateAgentMock).toHaveBeenCalledWith(7, { is_archived: true })
    expect(toastSuccessMock).toHaveBeenCalledWith('Archived')
  })

  it('deletes the agent after confirmation and shows a success toast', async () => {
    agentsRef.value = [{ id: 7, name: 'Alpha', tools: [] }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()

    const sections = wrapper.findComponent({ name: 'DashboardSections' })
    await sections.vm.$emit('delete', 7)
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete this agent? This permanently removes the agent and all its tasks.',
      'Delete agent',
      'Delete',
    )
    expect(deleteAgentMock).toHaveBeenCalledWith(7)
    expect(toastSuccessMock).toHaveBeenCalledWith('Agent deleted')
  })

  it('toggles favorite through the agent store', async () => {
    agentsRef.value = [{ id: 7, name: 'Alpha', tools: [], is_favorite: false }]
    filteredRef.value = agentsRef.value

    const wrapper = mount(DashboardPage, {
      global: {
        stubs: {
          GlobalNavbar: GlobalNavbarStub,
          DashboardHeader: DashboardHeaderStub,
          DashboardKpiStrip: DashboardKpiStripStub,
          DashboardToolbar: DashboardToolbarStub,
          DashboardFilterChips: DashboardFilterChipsStub,
          DashboardSections: DashboardSectionsStub,
          RouterLink: true,
        },
      },
    })
    await flushPromises()

    const sections = wrapper.findComponent({ name: 'DashboardSections' })
    await sections.vm.$emit('favorite', 7)
    await flushPromises()

    expect(updateAgentMock).toHaveBeenCalledWith(7, { is_favorite: true })
    expect(toastSuccessMock).toHaveBeenCalledWith('Added to favorites')
  })

  // Regression for the double-navigation fix: the page no longer
  // subscribes to `task-open` (the recent-task row uses
  // `<router-link>` directly). The DashboardSections stub therefore
  // must not emit `task-open` — if it did, the page handler would push
  // a second route onto the stack on top of the router-link's own
  // navigation.
  it('does not subscribe to task-open (router-link handles task rows directly)', () => {
    expect(DashboardSectionsStub.emits).not.toContain('task-open')
  })
})
