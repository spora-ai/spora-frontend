/**
 * GroupDangerZone — destructive actions owned by the group owner.
 *
 * Covers the isOwner / hasAgents computed gates, the delete flow (success
 * toast + navigate, error toast), and the transfer flow (no-op when target
 * is null, the per-agent POST loop, error inline, refresh after success).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}))

const toastMocks = { error: vi.fn(), success: vi.fn() }

vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMocks,
}))

const detailStoreMock = {
  agents: [] as Array<{ id: number }>,
  deleteGroup: vi.fn(),
  fetchDetail: vi.fn(),
}

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => detailStoreMock,
}))

const authState = { user: { id: 1, is_admin: false } as Record<string, unknown> | null }

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authState.user }),
}))

const apiPost = vi.fn()

vi.mock('@/api/client', () => ({
  default: { post: (...args: unknown[]) => apiPost(...args) },
  api: { post: (...args: unknown[]) => apiPost(...args) },
  ApiError: class FakeApiError extends Error {
    status: number
    constructor(msg = 'err', code = 'E', status = 500) {
      super(msg)
      this.status = status
      this.name = 'ApiError'
    }
  },
}))

import { useRouter } from 'vue-router'
import GroupDangerZone from '@/components/groups/GroupDangerZone.vue'

const routerPush = vi.fn()
vi.mocked(useRouter).mockReturnValue({ push: routerPush, replace: vi.fn() } as unknown as ReturnType<typeof useRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  authState.user = { id: 1, is_admin: false }
  detailStoreMock.agents = []
  detailStoreMock.deleteGroup = vi.fn()
  detailStoreMock.fetchDetail = vi.fn()
})

const baseGroup = { id: 7, name: 'Eng', description: '', my_role: 'owner' as const, member_count: 1 }

describe('GroupDangerZone', () => {
  it('renders nothing when the caller is not an owner', () => {
    authState.user = { id: 1, is_admin: false }
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, my_role: 'admin' } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    expect(wrapper.find('[role="region"], section, .danger-zone, button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Danger zone')
  })

  it('renders the danger zone for admins even when my_role is not owner', () => {
    authState.user = { id: 1, is_admin: true }
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, my_role: 'member' } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    expect(wrapper.text()).toContain('Danger zone')
  })

  it('disables the Transfer button when the group owns no agents', () => {
    detailStoreMock.agents = []
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 0 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const transferBtn = wrapper.findAll('button').find((b) => b.text().includes('Transfer all agents'))
    expect(transferBtn?.attributes('disabled')).toBeDefined()
  })

  it('enables the Transfer button when agent_count > 0', () => {
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 2 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const transferBtn = wrapper.findAll('button').find((b) => b.text().includes('Transfer all agents'))
    expect(transferBtn?.attributes('disabled')).toBeUndefined()
  })

  it('falls back to detailStore.agents.length when agent_count is undefined', () => {
    detailStoreMock.agents = [{ id: 1 }]
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const transferBtn = wrapper.findAll('button').find((b) => b.text().includes('Transfer all agents'))
    expect(transferBtn?.attributes('disabled')).toBeUndefined()
  })

  it('opens the delete modal when the Delete button is clicked', async () => {
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 0 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const deleteBtn = wrapper.findAll('button').find((b) => b.text() === 'Delete group')
    await deleteBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.html()).toContain('Delete Group')
  })

  it('on successful delete: toast.success + router.push to admin groups', async () => {
    detailStoreMock.deleteGroup = vi.fn().mockResolvedValueOnce(undefined)
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 0 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const vm = wrapper.vm as unknown as { performDelete: () => Promise<void> }
    await vm.performDelete()
    expect(detailStoreMock.deleteGroup).toHaveBeenCalledWith(7)
    expect(toastMocks.success).toHaveBeenCalledWith('Group deleted.')
    expect(routerPush).toHaveBeenCalledWith({ name: 'settings-admin-groups' })
  })

  it('on delete failure: toast.error without navigating', async () => {
    detailStoreMock.deleteGroup = vi.fn().mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 0 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const vm = wrapper.vm as unknown as { performDelete: () => Promise<void> }
    await vm.performDelete()
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to delete group.')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('performTransfer no-ops when transferTargetId is null', async () => {
    detailStoreMock.agents = [{ id: 1 }, { id: 2 }]
    apiPost.mockClear()
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 2 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const vm = wrapper.vm as unknown as { performTransfer: () => Promise<void> }
    await vm.performTransfer()
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('performTransfer POSTs /agents/{id}/transfer for every agent and refreshes detail', async () => {
    detailStoreMock.agents = [{ id: 10 }, { id: 11 }]
    apiPost.mockResolvedValue({ agent: {} })
    detailStoreMock.fetchDetail.mockResolvedValueOnce(undefined)
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 2 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const vm = wrapper.vm as unknown as { transferTargetId: number | null; performTransfer: () => Promise<void> }
    vm.transferTargetId = 99
    await vm.performTransfer()
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(apiPost).toHaveBeenNthCalledWith(1, '/agents/10/transfer', { principal_id: 99 })
    expect(apiPost).toHaveBeenNthCalledWith(2, '/agents/11/transfer', { principal_id: 99 })
    expect(detailStoreMock.fetchDetail).toHaveBeenCalledWith(7)
    expect(toastMocks.success).toHaveBeenCalledWith('Transferred 2 agent(s).')
  })

  it('performTransfer surfaces partial failure as a toast (0 of 1 transferred)', async () => {
    detailStoreMock.agents = [{ id: 10 }]
    apiPost.mockRejectedValueOnce(new Error('422'))
    const wrapper = mount(GroupDangerZone, {
      props: { group: { ...baseGroup, agent_count: 1 } },
      global: { stubs: { Modal: true, Icon: true } },
    })
    const vm = wrapper.vm as unknown as { transferTargetId: number | null; performTransfer: () => Promise<void> }
    vm.transferTargetId = 99
    await vm.performTransfer()
    expect(toastMocks.error).toHaveBeenCalledWith('Transferred 0 of 1 agents. 1 failed.')
    expect(toastMocks.success).not.toHaveBeenCalled()
  })
})
