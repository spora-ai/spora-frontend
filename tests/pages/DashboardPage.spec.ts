/**
 * DashboardPage — thin shell that composes the Phase-2 subcomponents.
 *
 * Tests focus on the shell's behaviour: mount-time fetch via
 * `useDashboardData().ensureLoaded`, the navbar + subcomponent tree, the
 * two empty-state variants, and the create-dialog trigger. Subcomponent
 * behaviour (KPIs, sections, toolbar) is covered by the per-component specs
 * under tests/components/dashboard/.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const agentsRef = ref<Array<{ id: number; name: string; tools: unknown[] }>>([])
const filteredRef = ref<Array<{ id: number; name: string; tools: unknown[] }>>([])
const isLoadingRef = ref(false)
const ensureLoadedMock = vi.fn()
const refreshMock = vi.fn()
const setChipMock = vi.fn()
const setQueryMock = vi.fn()
const setSortMock = vi.fn()

vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    agents: agentsRef,
    filteredAgents: filteredRef,
    isLoading: isLoadingRef,
    lastUpdatedAt: ref(null),
    refresh: refreshMock,
    ensureLoaded: ensureLoadedMock,
    setChip: setChipMock,
    setQuery: setQueryMock,
    setSort: setSortMock,
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

const DashboardHeaderStub = { name: 'DashboardHeader', template: '<div class="header-stub" />' }
const DashboardKpiStripStub = { name: 'DashboardKpiStrip', template: '<div class="kpi-stub" />' }
const DashboardToolbarStub = { name: 'DashboardToolbar', template: '<div class="toolbar-stub" />' }
const DashboardFilterChipsStub = { name: 'DashboardFilterChips', template: '<div class="chips-stub" />' }
const DashboardSectionsStub = { name: 'DashboardSections', template: '<div class="sections-stub" />' }
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
  pushMock.mockReset()
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
})
