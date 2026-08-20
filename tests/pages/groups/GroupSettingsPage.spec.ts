/**
 * GroupSettingsPage — name + description form + danger zone.
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
  agents: Array<unknown>
  toolSettings: Array<unknown>
  llmConfigs: Array<unknown>
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
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const updateGroupMock = vi.fn()
const deleteGroupMock = vi.fn()
const fetchDetailMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, {
      updateGroup: updateGroupMock,
      deleteGroup: deleteGroupMock,
      fetchDetail: fetchDetailMock,
    })
    return detailStoreMock
  },
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupSettingsPage from '@/pages/groups/GroupSettingsPage.vue'
import { ApiError } from '@/api/client'

const GroupDangerZoneStub = {
  name: 'GroupDangerZone',
  props: ['group'],
  template: '<div class="danger-zone-stub" />',
}

describe('GroupSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    updateGroupMock.mockResolvedValue({ ...(detailStoreMock.group as Record<string, unknown>), name: 'Renamed' })
    deleteGroupMock.mockResolvedValue(undefined)
    fetchDetailMock.mockResolvedValue(detailStoreMock.group)
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('seeds the form from the detail group', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    expect((wrapper.vm as { form: { name: string; description: string } }).form.name).toBe('Eng')
    expect((wrapper.vm as { form: { name: string; description: string } }).form.description).toBe('desc')
  })

  it('disables the inputs for member-only callers', () => {
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  })

  it('Save button is disabled when nothing changed', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    const buttons = wrapper.findAll('button')
    const saveBtn = buttons.find((b) => b.text().includes('Save Changes'))
    expect(saveBtn?.attributes('disabled')).toBeDefined()
  })

  it('Save button enables after a dirty edit', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    ;(wrapper.vm as { form: { name: string; description: string } }).form.name = 'New name'
    await flushPromises()
    const buttons = wrapper.findAll('button')
    const saveBtn = buttons.find((b) => b.text().includes('Save Changes'))
    expect(saveBtn?.attributes('disabled')).toBeUndefined()
  })

  it('submit() calls updateGroup when form is dirty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    ;(wrapper.vm as { form: { name: string; description: string } }).form.name = 'Renamed'
    await wrapper.vm.submit()
    expect(updateGroupMock).toHaveBeenCalledWith(1, { name: 'Renamed', description: 'desc' })
  })

  it('submit() returns early when form is not dirty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    await wrapper.vm.submit()
    expect(updateGroupMock).not.toHaveBeenCalled()
  })

  it('submit() returns early when name is empty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    ;(wrapper.vm as { form: { name: string; description: string } }).form.name = '   '
    await wrapper.vm.submit()
    expect(updateGroupMock).not.toHaveBeenCalled()
  })

  it('submit() surfaces ApiError via toast', async () => {
    updateGroupMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 422))
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    ;(wrapper.vm as { form: { name: string; description: string } }).form.name = 'Renamed'
    await wrapper.vm.submit()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })

  it('renders the danger zone for owners', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs: { Icon: true, Modal: true, GroupDangerZone: GroupDangerZoneStub } } })
    expect(wrapper.text()).toContain('Danger zone')
    expect(wrapper.find('.danger-zone-stub').exists()).toBe(true)
  })
})
