/**
 * GroupOverviewPage — renders 4 stat cards with counts from the detail
 * store, plus a snapshot of the group's agents.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

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

import GroupOverviewPage from '@/pages/groups/GroupOverviewPage.vue'

describe('GroupOverviewPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    routerPush.mockReset()
    toastMocks.error.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders 4 stat cards with the counts from the detail store', () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
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
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('1')
  })

  it('fetches agents on mount when the store is empty', async () => {
    detailStoreMock.fetchAgents = vi.fn().mockResolvedValueOnce([])
    mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    expect(detailStoreMock.fetchAgents).toHaveBeenCalledWith(1)
  })

  it('does not refetch when the store already has agents', async () => {
    detailStoreMock.agents = [{ id: 1, name: 'Cached', principal_id: 10 }]
    mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    expect(detailStoreMock.fetchAgents).not.toHaveBeenCalled()
  })

  it('surfaces an error toast when fetchAgents rejects', async () => {
    detailStoreMock.fetchAgents = vi.fn().mockRejectedValueOnce(new Error('boom'))
    mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    // Plain Error falls through to the generic toast message in the page.
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to load agents.')
  })

  it('shows an empty state when the group has no agents', async () => {
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('No agents yet')
  })

  it('renders one card per agent (up to the limit)', async () => {
    detailStoreMock.agents = [
      { id: 1, name: 'Alpha', principal_id: 10 },
      { id: 2, name: 'Beta', principal_id: 10 },
      { id: 3, name: 'Gamma', principal_id: 10 },
    ]
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Alpha')
    expect(text).toContain('Beta')
    expect(text).toContain('Gamma')
    expect(wrapper.findAll('button')).toEqual(
      expect.arrayContaining([expect.objectContaining({})]),
    )
    expect(wrapper.findAll('ul li')).toHaveLength(3)
  })

  it('caps the agent list at 6 and shows a "View all" link when more agents exist', async () => {
    detailStoreMock.agents = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${i + 1}`,
      principal_id: 10,
    }))
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    expect(wrapper.findAll('ul li')).toHaveLength(6)
    expect(wrapper.text()).toContain('View all (9)')
    expect(wrapper.text()).not.toContain('Agent 7')
  })

  it('navigates to /agents/:id when a card is clicked', async () => {
    detailStoreMock.agents = [{ id: 42, name: 'Helper', principal_id: 10 }]
    const wrapper = mount(GroupOverviewPage, { global: { stubs: { Icon: true } } })
    await flushPromises()
    const card = wrapper.findAll('ul li button')[0]
    await card.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'agent', params: { id: '42' } })
  })
})