/**
 * DeleteUserModal — admin user delete confirmation.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const deleteMock = vi.fn()

vi.mock('@/stores/users', () => ({
  useUsersStore: () => ({ deleteUser: deleteMock }),
}))

const ModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size'],
  emits: ['update:modelValue', 'close'],
  template: `
    <div v-if="modelValue" class="modal-stub">
      <div class="default-slot"><slot /></div>
      <div class="footer-slot"><slot name="footer" /></div>
    </div>
  `,
}

import DeleteUserModal from '@/components/admin/DeleteUserModal.vue'

beforeEach(() => {
  deleteMock.mockReset()
  deleteMock.mockResolvedValue(undefined)
})

describe('DeleteUserModal', () => {
  it('renders nothing when modelValue is false', () => {
    const wrapper = mount(DeleteUserModal, {
      props: { user: { id: 1, email: 'a@b.com', username: 'a', name: 'A', is_admin: false, roles: ['USER'], verified: true }, modelValue: false },
      global: { stubs: { Modal: ModalStub } },
    })
    expect(wrapper.find('.modal-stub').exists()).toBe(false)
  })

  it('renders the modal when modelValue is true', () => {
    const wrapper = mount(DeleteUserModal, {
      props: { user: { id: 1, email: 'a@b.com', username: 'a', name: 'A', is_admin: false, roles: ['USER'], verified: true }, modelValue: true },
      global: { stubs: { Modal: ModalStub } },
    })
    expect(wrapper.find('.modal-stub').exists()).toBe(true)
  })

  it('calls deleteUser on confirm', async () => {
    const wrapper = mount(DeleteUserModal, {
      props: { user: { id: 7, email: 'a@b.com', username: 'a', name: 'A', is_admin: false, roles: ['USER'], verified: true }, modelValue: true },
      global: { stubs: { Modal: ModalStub } },
    })
    const buttons = wrapper.findAll('button')
    const confirmButton = buttons.find((b) => b.text().toLowerCase().includes('delete user'))
    expect(confirmButton).toBeDefined()
    await confirmButton!.trigger('click')
    await flushPromises()
    expect(deleteMock).toHaveBeenCalledWith(7)
  })

  it('falls back to the catalogue sentence when the failure is not an ApiError', async () => {
    // The catch branches on `e instanceof ApiError`; a transport error
    // reaches the catalogue's own sentence instead of the host's message.
    deleteMock.mockRejectedValueOnce(new Error('network exploded'))
    const wrapper = mount(DeleteUserModal, {
      props: { user: { id: 7, email: 'a@b.com', username: 'a', name: 'A', is_admin: false, roles: ['USER'], verified: true }, modelValue: true },
      global: { stubs: { Modal: ModalStub } },
    })
    const confirmButton = wrapper.findAll('button').find((b) => b.text().toLowerCase().includes('delete user'))
    await confirmButton!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to delete user.')
  })
})
