/**
 * GroupAgentsPage — table of agents owned by the group + Transfer dialog.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

interface DetailMock {
  group: Record<string, unknown> | null
  members: Array<unknown>
  agents: Array<Record<string, unknown>>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: { id: 1, name: 'Eng', description: null, principal_id: 10 },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const fetchAgentsMock = vi.fn().mockResolvedValue([])
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, { fetchAgents: fetchAgentsMock })
    return detailStoreMock
  },
}))

const { apiPostMock } = vi.hoisted(() => ({ apiPostMock: vi.fn() }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    api: { ...actual.api, post: apiPostMock },
  }
})

import GroupAgentsPage from '@/pages/groups/GroupAgentsPage.vue'
import { ApiError } from '@/api/client'

describe('GroupAgentsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    fetchAgentsMock.mockResolvedValue([])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads agents on mount', async () => {
    mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    await flushPromises()
    expect(fetchAgentsMock).toHaveBeenCalledWith(1)
  })

  it('renders agents fetched into the store', () => {
    detailStoreMock.agents = [
      { id: 5, name: 'Helper', created_at: '2026-01-02T00:00:00Z' },
      { id: 9, name: 'Planner', created_at: '2026-02-01T00:00:00Z' },
    ]
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.text()).toContain('Helper')
    expect(wrapper.text()).toContain('Planner')
  })

  it('renders the empty state when no agents exist', () => {
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    expect(wrapper.text()).toContain('No agents owned by this group yet.')
  })

  it('openTransfer() seeds the dialog state', () => {
    detailStoreMock.agents = [{ id: 5, name: 'Helper' }]
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    expect(wrapper.vm.showTransfer).toBe(true)
    expect(wrapper.vm.transferringAgent?.id).toBe(5)
  })

  it('performTransfer() calls /agents/{id}/transfer and refreshes the list', async () => {
    detailStoreMock.agents = [{ id: 5, name: 'Helper' }]
    apiPostMock.mockResolvedValueOnce({})
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    wrapper.vm.transferTarget = 10
    await wrapper.vm.performTransfer()
    expect(apiPostMock).toHaveBeenCalledWith('/agents/5/transfer', { principal_id: 10 })
    expect(fetchAgentsMock).toHaveBeenCalledTimes(2)
  })

  it('performTransfer() surfaces ApiError via the inline error', async () => {
    apiPostMock.mockRejectedValueOnce(new ApiError('pending tasks', 'ERROR', 409))
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    wrapper.vm.transferTarget = 10
    await wrapper.vm.performTransfer()
    expect(wrapper.vm.transferError).toBe('pending tasks')
  })

  it('performTransfer() returns early when target is null', async () => {
    detailStoreMock.agents = [{ id: 5, name: 'Helper' }]
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    wrapper.vm.transferTarget = null
    await wrapper.vm.performTransfer()
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchAgentsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})
