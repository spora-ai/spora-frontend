/**
 * CreateGroupDialog — modal form for creating a group, surfaced by
 * the command palette's "Create group" action.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const toastSuccessMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccessMock, error: vi.fn() }),
}))

const { openMock, closeMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  closeMock: vi.fn(),
}))
const isOpenRef = ref(false)
vi.mock('@/stores/createGroupDialog', () => ({
  useCreateGroupDialogStore: () => ({
    get isOpen() { return isOpenRef.value },
    open: openMock,
    close: closeMock,
  }),
}))

const savingRef = ref(false)
const groupsRef = ref<unknown[]>([])
const createGroupMock = vi.fn()
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get saving() { return savingRef.value },
    get groups() { return groupsRef.value },
    createGroup: createGroupMock,
  }),
}))

import CreateGroupDialog from '@/components/agent/CreateGroupDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  isOpenRef.value = false
  savingRef.value = false
  groupsRef.value = []
  pushMock.mockReset()
  toastSuccessMock.mockReset()
  openMock.mockReset()
  closeMock.mockReset()
  createGroupMock.mockReset()
})

describe('CreateGroupDialog', () => {
  function mountDialog() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    return mount(CreateGroupDialog, {
      global: { stubs: { Teleport: true, Icon: true } },
      attachTo: container,
    })
  }

  it('does not render when the store is closed', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders the form when the store opens', async () => {
    const wrapper = mountDialog()
    isOpenRef.value = true
    await flushPromises()
    expect(wrapper.find('input#create-group-name').exists()).toBe(true)
    expect(wrapper.find('textarea#create-group-description').exists()).toBe(true)
    wrapper.unmount()
  })

  it('disables Create when the name is empty', async () => {
    const wrapper = mountDialog()
    isOpenRef.value = true
    await flushPromises()
    const createBtn = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Create'))!
    expect(createBtn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('posts via groupsStore.createGroup and routes to the new group', async () => {
    createGroupMock.mockResolvedValue({ id: 42, name: 'New', description: null, principal_id: 99 })
    const wrapper = mountDialog()
    isOpenRef.value = true
    await flushPromises()
    await wrapper.find('input#create-group-name').setValue('New')
    const createBtn = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Create'))!
    await createBtn.trigger('click')
    await flushPromises()
    expect(createGroupMock).toHaveBeenCalledWith({ name: 'New', description: undefined })
    expect(pushMock).toHaveBeenCalledWith({ name: 'group-overview', params: { id: '42' } })
    expect(toastSuccessMock).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows an inline error when createGroup throws', async () => {
    createGroupMock.mockRejectedValueOnce(new Error('Backend boom'))
    const wrapper = mountDialog()
    isOpenRef.value = true
    await flushPromises()
    await wrapper.find('input#create-group-name').setValue('New')
    const createBtn = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Create'))!
    await createBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Backend boom')
    expect(pushMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('passes the description when provided', async () => {
    createGroupMock.mockResolvedValue({ id: 42, name: 'New', description: 'Desc', principal_id: 99 })
    const wrapper = mountDialog()
    isOpenRef.value = true
    await flushPromises()
    await wrapper.find('input#create-group-name').setValue('New')
    await wrapper.find('textarea#create-group-description').setValue('Desc')
    const createBtn = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Create'))!
    await createBtn.trigger('click')
    await flushPromises()
    expect(createGroupMock).toHaveBeenCalledWith({ name: 'New', description: 'Desc' })
    wrapper.unmount()
  })
})
