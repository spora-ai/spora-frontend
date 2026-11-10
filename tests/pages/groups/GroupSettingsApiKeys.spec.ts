/**
 * The group's API keys section on the group settings page.
 *
 * Minting a group key is an *owner or admin* right, not a member one: a
 * member can read the group but must not be able to hand out a credential
 * that drives every agent in it.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  agents: Array<unknown>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
  locations: Array<{ id: number; name: string; address: string; is_default: boolean }>
  locationsLoading: boolean
  locationsError: string | null
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: { id: 1, name: 'Eng', description: 'desc', principal_id: 10, my_role: 'owner', member_count: 2, agent_count: 0 },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    locations: [],
    locationsLoading: false,
    locationsError: null,
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const fetchLocationsMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, { fetchLocations: fetchLocationsMock })
    return detailStoreMock
  },
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupSettingsPage from '@/pages/groups/GroupSettingsPage.vue'

const GroupApiKeysSectionStub = {
  name: 'GroupApiKeysSection',
  props: ['groupId'],
  template: '<div class="group-api-keys-stub" />',
}

function render() {
  return mount(GroupSettingsPage, {
    global: {
      stubs: {
        Icon: true,
        Modal: true,
        GroupDangerZone: { name: 'GroupDangerZone', props: ['group'], template: '<div />' },
        GroupProfilePictureSection: { name: 'GroupProfilePictureSection', template: '<div />' },
        GroupApiKeysSection: GroupApiKeysSectionStub,
      },
    },
  })
}

describe('the group API keys section', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    fetchLocationsMock.mockResolvedValue([])
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'owner@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  it('mounts for a group owner', () => {
    const wrapper = render()
    expect(wrapper.find('.group-api-keys-stub').exists()).toBe(true)
  })

  it('mounts for a group admin', () => {
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'admin' }
    const wrapper = render()
    expect(wrapper.find('.group-api-keys-stub').exists()).toBe(true)
  })

  it('stays hidden for a plain member', () => {
    // A member can read the group but must not be able to mint a credential
    // that drives every agent in it.
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = render()
    expect(wrapper.find('.group-api-keys-stub').exists()).toBe(false)
  })
})
