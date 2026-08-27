/**
 * GroupProfilePictureSection — thin group-side wrapper around the
 * cross-subject `ProfilePictureSection`. Drives commit / upload /
 * remove through `useGroupDetailStore`.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive } from 'vue'

const updateProfilePictureMock = vi.fn()
const uploadProfilePictureImageMock = vi.fn()
const deleteProfilePictureImageMock = vi.fn()

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => ({
    updateProfilePicture: updateProfilePictureMock,
    uploadProfilePictureImage: uploadProfilePictureImageMock,
    deleteProfilePictureImage: deleteProfilePictureImageMock,
  }),
}))

import GroupProfilePictureSection from '@/components/groups/GroupProfilePictureSection.vue'

const ProfilePictureSectionStub = {
  name: 'ProfilePictureSection',
  props: ['subject', 'initials', 'profilePicture', 'commit', 'upload', 'remove'],
  template: '<div class="section-stub" />',
}

const STUBS = { ProfilePictureSection: ProfilePictureSectionStub }

const group = reactive({
  id: 7,
  name: 'Eng',
  description: 'desc',
  principal_id: 10,
  my_role: 'owner',
  member_count: 2,
  profile_picture: null,
})

describe('GroupProfilePictureSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    updateProfilePictureMock.mockResolvedValue(group)
    uploadProfilePictureImageMock.mockResolvedValue(group)
    deleteProfilePictureImageMock.mockResolvedValue(group)
  })

  it('passes subject="group" to the cross-subject ProfilePictureSection', () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    expect(inner.props('subject')).toBe('group')
  })

  it('derives initials from the first character of the group name', () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    expect(inner.props('initials')).toBe('E')
  })

  it('falls back to "?" when the group name is empty', () => {
    group.name = ''
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    expect(inner.props('initials')).toBe('?')
    group.name = 'Eng' // restore for following tests
  })

  it('forwards the current group.profile_picture through (null when none)', () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    expect(inner.props('profilePicture')).toBeNull()
  })

  it('forwards the saved profile_picture when one exists', () => {
    const picture = { kind: 'avatar' as const, archetype: 'sage', variant_key: 'v0', palette_key: 'stone', fg_color: '#000', bg_color: '#fff', image_url: null, image_updated_at: null }
    group.profile_picture = picture
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    expect(inner.props('profilePicture')).toEqual(picture)
    group.profile_picture = null
  })

  it('routes commit calls through to detailStore.updateProfilePicture', async () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    const commit = inner.props('commit') as (patch: object) => Promise<void>
    await commit({ archetype: 'sage', variant_key: 'v0', palette_key: 'stone' })
    expect(updateProfilePictureMock).toHaveBeenCalledWith(7, {
      archetype: 'sage',
      variant_key: 'v0',
      palette_key: 'stone',
    })
  })

  it('routes upload calls through to detailStore.uploadProfilePictureImage', async () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    const upload = inner.props('upload') as (file: File) => Promise<void>
    const file = new File(['x'], 'avatar.png', { type: 'image/png' })
    await upload(file)
    expect(uploadProfilePictureImageMock).toHaveBeenCalledWith(7, file)
  })

  it('routes remove calls through to detailStore.deleteProfilePictureImage', async () => {
    const wrapper = mount(GroupProfilePictureSection, {
      props: { group, groupId: 7 },
      global: { stubs: STUBS },
    })
    const inner = wrapper.findComponent({ name: 'ProfilePictureSection' })
    const remove = inner.props('remove') as () => Promise<void>
    await remove()
    expect(deleteProfilePictureImageMock).toHaveBeenCalledWith(7)
  })
})