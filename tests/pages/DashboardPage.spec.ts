/**
 * DashboardPage — renders the agent list from the agent store.
 *
 * The "+ New agent" affordance is mounted in the global navbar; this
 * test only verifies the dashboard's listing / count / empty-state
 * behaviour. The unified Create Agent dialog has its own spec.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const agentsRef = ref<Array<{ id: number; name: string; description?: string | null; tools: unknown[] }>>([])
const fetchAgentsMock = vi.fn()
const lastTaskByAgentMock = new Map<number, unknown>()

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get agents() { return agentsRef.value },
    fetchAgents: fetchAgentsMock,
  }),
}))

const fetchTasksMock = vi.fn()
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    fetchTasks: fetchTasksMock,
    lastTaskByAgent: lastTaskByAgentMock,
  }),
}))

const GlobalNavbarStub = { name: 'GlobalNavbar', template: '<div class="navbar-stub" />' }

import DashboardPage from '@/pages/DashboardPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  agentsRef.value = []
  fetchAgentsMock.mockReset()
  fetchAgentsMock.mockResolvedValue(undefined)
  fetchTasksMock.mockReset()
  fetchTasksMock.mockResolvedValue(undefined)
  pushMock.mockReset()
})

describe('DashboardPage', () => {
  it('renders the navbar', () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    expect(wrapper.find('.navbar-stub').exists()).toBe(true)
  })

  it('fetches agents and tasks on mount', async () => {
    mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    await flushPromises()
    expect(fetchAgentsMock).toHaveBeenCalled()
    expect(fetchTasksMock).toHaveBeenCalled()
  })

  it('renders an empty-state when there are no agents', async () => {
    const wrapper = mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toMatch(/no agents|create your first/i)
  })

  it('renders the list of agents', async () => {
    agentsRef.value = [
      { id: 1, name: 'Alpha', description: 'first', tools: [] },
      { id: 2, name: 'Beta', description: null, tools: [] },
    ]
    const wrapper = mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
  })

  it('shows the agent count next to the header', async () => {
    agentsRef.value = [
      { id: 1, name: 'Alpha', description: null, tools: [] },
      { id: 2, name: 'Beta', description: null, tools: [] },
    ]
    const wrapper = mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('2 agents')
  })

  it('navigates to the agent detail page when an agent row is clicked', async () => {
    agentsRef.value = [
      { id: 7, name: 'Gamma', description: null, tools: [] },
    ]
    const wrapper = mount(DashboardPage, {
      global: { stubs: { GlobalNavbar: GlobalNavbarStub, RouterLink: true } },
    })
    await flushPromises()
    const row = wrapper.find('li.cursor-pointer')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: 7 } })
  })
})