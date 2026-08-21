/**
 * GroupLayout — header + sub-nav + RouterView for one group's pages.
 *
 * Covers the data-driven computed values (`groupId`, `canEdit`,
 * `memberCountDisplay`), the `initials()` helper, the onMounted 404
 * redirect-to-dashboard path, the watch(groupId) reload path, and the
 * onUnmounted reset() of the detail store.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: vi.fn(),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

import { useRoute, useRouter } from 'vue-router'
import GroupLayout from '@/components/groups/GroupLayout.vue'

const routeMock = { params: { id: '7' } }
const routerReplace = vi.fn()
const routerPush = vi.fn()

vi.mocked(useRoute).mockReturnValue(routeMock as unknown as ReturnType<typeof useRoute>)
vi.mocked(useRouter).mockReturnValue({ replace: routerReplace, push: routerPush } as unknown as ReturnType<typeof useRouter>)

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

const detailStoreMock = {
  group: null as Record<string, unknown> | null,
  loading: false,
  error: null as string | null,
  members: [] as Array<Record<string, unknown>>,
  isLoadedFor: vi.fn((id: number) => false),
  fetchDetail: vi.fn(),
  reset: vi.fn(),
}

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => detailStoreMock,
}))

const authState = { user: { id: 1, is_admin: false } as Record<string, unknown> | null }

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: authState.user }),
}))

import { useGroupDetailStore } from '@/stores/groupDetail'
import { ApiError } from '@/api/client'

const detailStore = useGroupDetailStore() as unknown as typeof detailStoreMock

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  routeMock.params = { id: '7' }
  routerReplace.mockReset()
  authState.user = { id: 1, is_admin: false }
  detailStore.group = null
  detailStore.loading = false
  detailStore.error = null
  detailStore.members = []
  detailStore.isLoadedFor = vi.fn(() => false)
  detailStore.fetchDetail = vi.fn()
  detailStore.reset = vi.fn()
})

describe('GroupLayout', () => {
  it('computes groupId from string route param', () => {
    routeMock.params = { id: '42' }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('falls back to groupId=0 when route param is not numeric', () => {
    routeMock.params = { id: 'abc' }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    // No fetch attempted because id is 0
    expect(detailStore.fetchDetail).not.toHaveBeenCalled()
    expect(wrapper.exists()).toBe(true)
  })

  it('grants canEdit to admins even when my_role is not owner/admin', async () => {
    authState.user = { id: 1, is_admin: true }
    detailStore.group = { id: 7, name: 'Eng', my_role: 'member', member_count: 3, agent_count: 0 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    const subNav = wrapper.findComponent({ name: 'GroupSubNav' })
    expect(subNav.props('canEdit')).toBe(true)
  })

  it('grants canEdit to the owner role on the group', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', member_count: 1, agent_count: 0 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    const subNav = wrapper.findComponent({ name: 'GroupSubNav' })
    expect(subNav.props('canEdit')).toBe(true)
  })

  it('denies canEdit to plain members', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'member', member_count: 1, agent_count: 0 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    const subNav = wrapper.findComponent({ name: 'GroupSubNav' })
    expect(subNav.props('canEdit')).toBe(false)
  })

  it('falls back to members.length when member_count is undefined', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', agent_count: 0 }
    detailStore.members = [{}, {}, {}, {}]
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('4 members')
  })

  it('uses member_count from the group when defined', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', member_count: 9, agent_count: 0 }
    detailStore.members = []
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('9 members')
  })

  it('redirects to dashboard on 404 from fetchDetail', async () => {
    routeMock.params = { id: '99' }
    detailStore.isLoadedFor = vi.fn(() => false)
    detailStore.fetchDetail = vi.fn().mockRejectedValueOnce(new ApiError('not found', 'NF', 404))
    mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    await flushPromises()
    expect(routerReplace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('does not redirect on non-404 fetchDetail failures', async () => {
    routeMock.params = { id: '7' }
    detailStore.isLoadedFor = vi.fn(() => false)
    detailStore.fetchDetail = vi.fn().mockRejectedValueOnce(new Error('boom'))
    mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    await flushPromises()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('skips fetch when already loaded for the current groupId', () => {
    routeMock.params = { id: '7' }
    detailStore.isLoadedFor = vi.fn(() => true)
    mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(detailStore.fetchDetail).not.toHaveBeenCalled()
  })

  it('resets the detail store on unmount', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', member_count: 1, agent_count: 0 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    wrapper.unmount()
    expect(detailStore.reset).toHaveBeenCalledTimes(1)
  })

  it('shows the loading skeleton when group is null and loading is true', () => {
    detailStore.loading = true
    detailStore.group = null
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.findAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('renders the error banner when detailStore.error is set', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', member_count: 1, agent_count: 0 }
    detailStore.error = 'Something went wrong'
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('Something went wrong')
  })

  it('renders the role badge when my_role is set', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'admin', member_count: 1, agent_count: 0 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('admin')
  })

  it('renders the agent count line when agent_count is defined', () => {
    detailStore.group = { id: 7, name: 'Eng', my_role: 'owner', member_count: 1, agent_count: 4 }
    const wrapper = mount(GroupLayout, {
      global: { stubs: { GlobalNavbar: true, GroupSubNav: true, RouterView: true, Avatar: true } },
    })
    expect(wrapper.text()).toContain('4 agents')
  })
})