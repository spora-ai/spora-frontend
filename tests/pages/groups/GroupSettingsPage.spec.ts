/**
 * GroupSettingsPage — name + description + information form + locations +
 * danger zone.
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
  locations: Array<{ id: number; name: string; address: string; is_default: boolean }>
  locationsLoading: boolean
  locationsError: string | null
  loading: boolean
  error: string | null
}

function freshDetail(): DetailMock {
  return {
    group: { id: 1, name: 'Eng', description: 'desc', information: '## Address', principal_id: 10, my_role: 'owner', member_count: 2, agent_count: 0 },
    members: [],
    agents: [],
    toolSettings: [],
    llmConfigs: [],
    locations: [{ id: 7, name: 'HQ', address: 'Musterstraße 1', is_default: true }],
    locationsLoading: false,
    locationsError: null,
    loading: false,
    error: null,
  }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

const updateGroupMock = vi.fn()
const deleteGroupMock = vi.fn()
const fetchDetailMock = vi.fn()
const fetchLocationsMock = vi.fn()
const createLocationMock = vi.fn()
const updateLocationMock = vi.fn()
const deleteLocationMock = vi.fn()
vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => {
    Object.assign(detailStoreMock, {
      updateGroup: updateGroupMock,
      deleteGroup: deleteGroupMock,
      fetchDetail: fetchDetailMock,
      fetchLocations: fetchLocationsMock,
      createLocation: createLocationMock,
      updateLocation: updateLocationMock,
      deleteLocation: deleteLocationMock,
    })
    return detailStoreMock
  },
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupSettingsPage from '@/pages/groups/GroupSettingsPage.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { ApiError } from '@/api/client'

const GroupDangerZoneStub = {
  name: 'GroupDangerZone',
  props: ['group'],
  template: '<div class="danger-zone-stub" />',
}

const stubs = {
  Icon: true,
  Modal: true,
  GroupDangerZone: GroupDangerZoneStub,
  GroupProfilePictureSection: { name: "GroupProfilePictureSection", template: "<div data-testid=\"profile-picture-section-stub\" />" },
}

describe('GroupSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    updateGroupMock.mockResolvedValue({ ...(detailStoreMock.group as Record<string, unknown>), name: 'Renamed' })
    deleteGroupMock.mockResolvedValue(undefined)
    fetchDetailMock.mockResolvedValue(detailStoreMock.group)
    fetchLocationsMock.mockResolvedValue(detailStoreMock.locations)
    createLocationMock.mockResolvedValue({ id: 8, name: 'Berlin', address: 'Alexanderplatz 1', is_default: false })
    updateLocationMock.mockResolvedValue({ id: 7, name: 'HQ', address: 'Musterstraße 1', is_default: true })
    deleteLocationMock.mockResolvedValue(undefined)
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('seeds the form from the detail group', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    expect((wrapper.vm as unknown as { form: { name: string; description: string } }).form.name).toBe('Eng')
    expect((wrapper.vm as unknown as { form: { name: string; description: string } }).form.description).toBe('desc')
  })

  it('mounts the GroupProfilePictureSection above the profile form', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    expect(wrapper.find('[data-testid="profile-picture-section-stub"]').exists()).toBe(true)
  })

  it('disables the inputs for member-only callers', () => {
    detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  })

  it('Save button is disabled when nothing changed', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    const buttons = wrapper.findAll('button')
    const saveBtn = buttons.find((b) => b.text().includes('Save Changes'))
    expect(saveBtn?.attributes('disabled')).toBeDefined()
  })

  it('Save button enables after a dirty edit', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    ;(wrapper.vm as unknown as { form: { name: string; description: string } }).form.name = 'New name'
    await flushPromises()
    const buttons = wrapper.findAll('button')
    const saveBtn = buttons.find((b) => b.text().includes('Save Changes'))
    expect(saveBtn?.attributes('disabled')).toBeUndefined()
  })

  it('submit() calls updateGroup when form is dirty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    ;(wrapper.vm as unknown as { form: { name: string; description: string } }).form.name = 'Renamed'
    await (wrapper.vm as unknown as { submit: () => Promise<void> }).submit()
    // The information did not change, and a field the payload does not name
    // is left alone by the server.
    expect(updateGroupMock).toHaveBeenCalledWith(1, { name: 'Renamed', description: 'desc', information: undefined })
  })

  it('submit() returns early when form is not dirty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    await (wrapper.vm as unknown as { submit: () => Promise<void> }).submit()
    expect(updateGroupMock).not.toHaveBeenCalled()
  })

  it('submit() returns early when name is empty', async () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    ;(wrapper.vm as unknown as { form: { name: string; description: string } }).form.name = '   '
    await (wrapper.vm as unknown as { submit: () => Promise<void> }).submit()
    expect(updateGroupMock).not.toHaveBeenCalled()
  })

  it('submit() surfaces ApiError via toast', async () => {
    updateGroupMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 422))
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    ;(wrapper.vm as unknown as { form: { name: string; description: string } }).form.name = 'Renamed'
    await (wrapper.vm as unknown as { submit: () => Promise<void> }).submit()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })

  it('renders the danger zone for owners', () => {
    const wrapper = mount(GroupSettingsPage, { global: { stubs } })
    expect(wrapper.text()).toContain('Danger zone')
    expect(wrapper.find('.danger-zone-stub').exists()).toBe(true)
  })

  describe('group information', () => {
    it('edits the information through a full-mode markdown editor', () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      const editor = wrapper.findComponent(MarkdownEditor)
      expect(editor.exists()).toBe(true)
      expect(editor.props('mode')).toBe('full')
      expect(editor.props('rows')).toBe(6)
      expect(editor.props('modelValue')).toBe('## Address')
    })

    it('saves the information together with the name and the description', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      ;(wrapper.vm as unknown as { form: { information: string } }).form.information = '## Address\nMusterstraße 1'
      await (wrapper.vm as unknown as { submit: () => Promise<void> }).submit()
      expect(updateGroupMock).toHaveBeenCalledWith(1, {
        name: 'Eng',
        description: 'desc',
        information: '## Address\nMusterstraße 1',
      })
    })

    it('marks the form dirty when only the information changed', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      ;(wrapper.vm as unknown as { form: { information: string } }).form.information = '## Address\nMusterstraße 1'
      await flushPromises()
      const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('Save Changes'))
      expect(saveBtn?.attributes('disabled')).toBeUndefined()
    })
  })

  describe('locations', () => {
    it('loads the group locations on mount', async () => {
      mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      expect(fetchLocationsMock).toHaveBeenCalledWith(1)
    })

    it('renders the group locations', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.text()).toContain('HQ')
      expect(wrapper.text()).toContain('Musterstraße 1')
    })

    it('hides the mutating controls for member-only callers', async () => {
      detailStoreMock.group = { ...detailStoreMock.group, my_role: 'member' }
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.text()).toContain('HQ')
      const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add location'))
      expect(addBtn).toBeUndefined()
      expect(wrapper.findAll('[data-testid="location-row"] button')).toHaveLength(0)
    })

    it('creates a location through the store', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      await wrapper.findAll('button').find(b => b.text().includes('Add location'))!.trigger('click')
      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()
      expect(createLocationMock).toHaveBeenCalledWith(1, { name: 'Berlin', address: 'Alexanderplatz 1', is_default: false })
    })

    it('updates a location through the store', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[0].trigger('click')
      await wrapper.find('[id="loc-name"]').setValue('Headquarters')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()
      expect(updateLocationMock).toHaveBeenCalledWith(1, 7, expect.objectContaining({ name: 'Headquarters' }))
    })

    it('deletes a location through the store', async () => {
      const wrapper = mount(GroupSettingsPage, { global: { stubs } })
      await flushPromises()
      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[1].trigger('click')
      await flushPromises()
      expect(deleteLocationMock).toHaveBeenCalledWith(1, 7)
    })
  })

  // The page mounts as a child of GroupLayout, which fetches the group detail
  // in its own onMounted — and a child's onMounted runs first. The store
  // therefore has no group while this page mounts, so the locations can only
  // be loaded once the group id shows up.
  it('loads the locations once the group arrives, not on mount', async () => {
    const group = detailStoreMock.group
    detailStoreMock.group = null
    mount(GroupSettingsPage, { global: { stubs } })
    await flushPromises()
    expect(fetchLocationsMock).not.toHaveBeenCalled()

    detailStoreMock.group = group
    await flushPromises()
    expect(fetchLocationsMock).toHaveBeenCalledWith(1)
  })
})
