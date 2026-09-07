/**
 * GroupMembersModal — admin-panel overlay for group member management.
 * Mirrors `EditUserModal.spec.ts` patterns. Stubs `<Modal>` so the
 * Teleport surface isn't required and the form contract is asserted
 * directly.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const fetchMembersMock = vi.fn()
const addMemberMock = vi.fn()
const updateMemberMock = vi.fn()
const removeMemberMock = vi.fn()

vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    fetchMembers: fetchMembersMock,
    addMember: addMemberMock,
    updateMember: updateMemberMock,
    removeMember: removeMemberMock,
  }),
}))

const mockAuthUser = { id: 99, email: 'admin@x.com', name: 'Admin', roles: ['ADMIN'], is_admin: true }

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: mockAuthUser }),
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccessMock, error: toastErrorMock }),
}))

const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

import { ApiError } from '@/api/client'
import GroupMembersModal from '@/components/admin/GroupMembersModal.vue'

const ModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size', 'backdropClosable'],
  emits: ['update:modelValue', 'close'],
  template: `
    <div v-if="modelValue" class="modal-stub" data-testid="modal">
      <div class="default-slot"><slot /></div>
      <div class="footer-slot"><slot name="footer" /></div>
    </div>
  `,
}

const IconStub = { name: 'Icon', template: '<i class="icon-stub" />' }

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Marketing',
    description: 'Outbound',
    principal_id: 100,
    member_count: 2,
    members: [],
    my_role: 'admin',
    ...overrides,
  }
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    role: 'member' as const,
    ...overrides,
  }
}

describe('GroupMembersModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    fetchMembersMock.mockResolvedValue([makeMember(), makeMember({ user_id: 2, name: 'Bob', email: 'bob@example.com', role: 'admin' })])
    addMemberMock.mockResolvedValue(makeMember({ user_id: 3, name: 'Carol', email: 'carol@example.com', role: 'member' }))
    updateMemberMock.mockResolvedValue(makeMember({ user_id: 1, role: 'admin' }))
    removeMemberMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('does not render when modelValue is false', () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: false },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false)
  })

  it('fetches members on open and renders the list', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    expect(fetchMembersMock).toHaveBeenCalledWith(7)
    expect(wrapper.findAll('[data-testid^="member-row-"]')).toHaveLength(2)
  })

  it('refetches when the group prop changes while open', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    fetchMembersMock.mockClear()
    await wrapper.setProps({ group: makeGroup({ id: 8 }) })
    expect(fetchMembersMock).toHaveBeenCalledWith(8)
  })

  it('resets local state on close so reopening does not flash stale rows', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="member-row-"]')).toHaveLength(2)
    await wrapper.setProps({ modelValue: false })
    expect((wrapper.vm as unknown as { members: unknown[] }).members).toEqual([])
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="member-row-"]')).toHaveLength(2)
  })

  it('adds a member and appends to the list', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('#gm-add-email').setValue('carol@example.com')
    await wrapper.find('[data-testid="gm-add-submit"]').trigger('click')
    await flushPromises()
    expect(addMemberMock).toHaveBeenCalledWith(7, { email: 'carol@example.com' }, 'member')
    expect(wrapper.findAll('[data-testid^="member-row-"]')).toHaveLength(3)
    expect(toastSuccessMock).toHaveBeenCalledWith('Member added.')
  })

  it('blocks the add submit when the email is malformed (no @)', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('#gm-add-email').setValue('not-an-email')
    const submit = wrapper.find('[data-testid="gm-add-submit"]')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    await submit.trigger('click')
    expect(addMemberMock).not.toHaveBeenCalled()
  })

  it('surfaces backend role-rule violations inline without toasting', async () => {
    addMemberMock.mockRejectedValueOnce(new ApiError('Only owners can add owners.', 'ROLE_RULE_VIOLATION', 409))
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('#gm-add-email').setValue('carol@example.com')
    await wrapper.find('[data-testid="gm-add-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('changes a member role on select change', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    const select = wrapper.find('[data-testid="member-role-1"]')
    await select.setValue('admin')
    await flushPromises()
    expect(updateMemberMock).toHaveBeenCalledWith(7, 1, 'admin')
  })

  it('hides the remove button on the caller\'s own row (no self-evict)', async () => {
    fetchMembersMock.mockResolvedValueOnce([
      makeMember({ user_id: 99, role: 'admin' }),
      makeMember({ user_id: 1, name: 'Alice', email: 'alice@example.com', role: 'member' }),
    ])
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="member-remove-99"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-remove-1"]').exists()).toBe(true)
  })

  it('removes a member after confirm and shrinks the list', async () => {
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('[data-testid="member-remove-1"]').trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalled()
    expect(removeMemberMock).toHaveBeenCalledWith(7, 1)
    expect(wrapper.findAll('[data-testid^="member-row-"]')).toHaveLength(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('Member removed.')
  })

  it('does not remove when the confirm dialog declines', async () => {
    confirmMock.mockResolvedValueOnce(false)
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('[data-testid="member-remove-1"]').trigger('click')
    await flushPromises()
    expect(removeMemberMock).not.toHaveBeenCalled()
  })

  it('surfaces remove failures via toast', async () => {
    removeMemberMock.mockRejectedValueOnce(new ApiError('nope', 'ERROR', 500))
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    await wrapper.find('[data-testid="member-remove-1"]').trigger('click')
    await flushPromises()
    expect(toastErrorMock).toHaveBeenCalledWith('nope')
  })

  it('shows the load-error panel when the initial fetch fails', async () => {
    fetchMembersMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    const wrapper = mount(GroupMembersModal, {
      props: { group: makeGroup(), modelValue: true },
      global: { stubs: { Modal: ModalStub, Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('boom')
  })
})
