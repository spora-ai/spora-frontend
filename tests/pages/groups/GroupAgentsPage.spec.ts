/**
 * GroupAgentsPage — table of agents owned by the group + Transfer dialog.
 * Each row also exposes an Open link to /agents/:id.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive, ref } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

interface DetailMock {
  group: { id: number; name: string; description: string | null; principal_id: number; my_role?: string } | null
  members: Array<unknown>
  agents: Array<{ id: number; name: string; created_at?: string }>
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

const principalsRef = reactive<Array<{ id: number; type: 'user' | 'group'; name: string; user_id?: number; group_id?: number }>>([])
const principalsLoadMock = vi.fn().mockResolvedValue([])
vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => ({
    get principals() { return principalsRef },
    load: principalsLoadMock,
  }),
}))

const authUserRef = ref<{ id: number; email: string; is_admin: boolean } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return authUserRef.value },
  }),
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
    principalsRef.splice(0, principalsRef.length)
    authUserRef.value = null
    pushMock.mockReset()
    vi.clearAllMocks()
    fetchAgentsMock.mockResolvedValue([])
    principalsLoadMock.mockResolvedValue([])
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

  it('renders an Open link per row that navigates to /agents/:id', async () => {
    detailStoreMock.agents = [{ id: 5, name: 'Helper', created_at: '2026-01-02T00:00:00Z' }]
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openAgent(5)
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: '5' } })
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
    wrapper.vm.transferTargetPrincipalId = 10
    await wrapper.vm.performTransfer()
    expect(apiPostMock).toHaveBeenCalledWith('/agents/5/transfer', { principal_id: 10 })
    expect(fetchAgentsMock).toHaveBeenCalledTimes(2)
  })

  it('performTransfer() surfaces ApiError via the inline error', async () => {
    apiPostMock.mockRejectedValueOnce(new ApiError('pending tasks', 'ERROR', 409))
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    wrapper.vm.transferTargetPrincipalId = 10
    await wrapper.vm.performTransfer()
    expect(wrapper.vm.transferError).toBe('pending tasks')
  })

  it('performTransfer() returns early when target is null', async () => {
    detailStoreMock.agents = [{ id: 5, name: 'Helper' }]
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    wrapper.vm.openTransfer({ id: 5, name: 'Helper' })
    wrapper.vm.transferTargetPrincipalId = null
    await wrapper.vm.performTransfer()
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('principal picker excludes the current group principal and shows groups + caller user', () => {
    authUserRef.value = { id: 7, email: 'a@x', is_admin: false }
    principalsRef.push(
      { id: 10, type: 'group', name: 'Engineering', group_id: 1 },
      { id: 20, type: 'group', name: 'Ops', group_id: 2 },
      { id: 30, type: 'user', name: 'Caller User', user_id: 7 },
      { id: 40, type: 'user', name: 'Other User', user_id: 99 },
    )
    detailStoreMock.group = { id: 1, name: 'Eng', description: null, principal_id: 10 }
    const wrapper = mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    const labels = wrapper.vm.principalOptions.map((p: { id: number }) => p.id)
    expect(labels).toEqual([20, 30])
  })

  it('on-mount surfaces load failures via toast', async () => {
    fetchAgentsMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupAgentsPage, { global: { stubs: { Icon: true, Modal: true } } })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })
})
