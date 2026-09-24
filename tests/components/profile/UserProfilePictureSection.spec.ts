/**
 * UserProfilePictureSection — `/account` wrapper around the cross-subject
 * ProfilePictureSection. Locks the section to `subject="user"` (image
 * only, archetype tab hidden) and wires `upload`/`remove` to the auth
 * store. Happy-path integration with `Avatar.vue` is covered
 * indirectly via AccountPage; this spec covers the wrapper's
 * `upload`/`remove` plumbing and the `showArchetypeTab=false`
 * invariant.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { uploadProfilePicture, deleteProfilePicture, currentUser } = vi.hoisted(() => {
  const currentUser = {
    id: 12,
    name: 'Test User',
    email: 'test@example.com',
    profile_picture: null as { kind: 'image'; image_url: string; image_updated_at: string } | null,
  }
  return {
    currentUser,
    uploadProfilePicture: vi.fn(),
    deleteProfilePicture: vi.fn(),
  }
})

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return currentUser },
    uploadProfilePicture,
    deleteProfilePicture,
  }),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

import UserProfilePictureSection from '@/components/profile/UserProfilePictureSection.vue'

beforeEach(() => {
  uploadProfilePicture.mockReset()
  deleteProfilePicture.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  currentUser.profile_picture = null
  setActivePinia(createPinia())
})

describe('UserProfilePictureSection', () => {
  it('hides the Avatar tab (image-only pipeline)', () => {
    const wrapper = mount(UserProfilePictureSection)
    expect(wrapper.find('[data-testid="tab-avatar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="panel-avatar"]').exists()).toBe(false)
  })

  it('renders the file picker on the Image tab by default', () => {
    const wrapper = mount(UserProfilePictureSection)
    expect(wrapper.find('[data-testid="panel-image"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="picture-file"]').exists()).toBe(true)
  })

  it('calls auth.uploadProfilePicture when the picker file is uploaded', async () => {
    uploadProfilePicture.mockResolvedValueOnce(undefined)
    const wrapper = mount(UserProfilePictureSection)
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' })
    const fileInput = wrapper.find('[data-testid="picture-file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [file] })
    await fileInput.trigger('change')

    await wrapper.find('[data-testid="upload-image"]').trigger('click')

    expect(uploadProfilePicture).toHaveBeenCalledWith(file)
    expect(toastSuccess).toHaveBeenCalledWith('Profile Picture updated.')
  })

  it('surfaces upload errors via the toast', async () => {
    uploadProfilePicture.mockRejectedValueOnce(new Error('rejected'))
    const wrapper = mount(UserProfilePictureSection)
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' })
    const fileInput = wrapper.find('[data-testid="picture-file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [file] })
    await fileInput.trigger('change')

    await wrapper.find('[data-testid="upload-image"]').trigger('click')

    expect(toastError).toHaveBeenCalledWith('Upload failed.')
  })

  it('calls auth.deleteProfilePicture on remove when a picture is present', async () => {
    currentUser.profile_picture = {
      kind: 'image',
      image_url: '/api/v1/users/12/picture',
      image_updated_at: '2026-09-23T10:00:00+00:00',
    }
    deleteProfilePicture.mockResolvedValueOnce(undefined)

    const wrapper = mount(UserProfilePictureSection)
    await wrapper.find('[data-testid="remove-image"]').trigger('click')

    expect(deleteProfilePicture).toHaveBeenCalledOnce()
    expect(toastSuccess).toHaveBeenCalledWith('Profile picture removed.')
  })

  it('does not render the remove button when no picture is set', () => {
    const wrapper = mount(UserProfilePictureSection)
    expect(wrapper.find('[data-testid="remove-image"]').exists()).toBe(false)
  })
})
