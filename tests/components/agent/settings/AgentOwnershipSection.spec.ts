/**
 * AgentOwnershipSection — current-owner chip + Transfer ownership dialog.
 *
 * Mirrors the Group page's Transfer dialog UX: a select of principals the
 * caller controls (filtered server-side by group membership + role),
 * excluding the current owner so the dropdown never offers a no-op. On
 * confirm, POSTs to /agents/{id}/transfer and surfaces failures inline.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, ref } from 'vue'

vi.mock('vue-router', () => ({
  RouterLink: {
    name: 'RouterLink',
    props: ['to'],
    template: '<a><slot /></a>',
  },
}))

const toastMock = vi.hoisted(
  () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
)
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

const authUserRef = ref<{ id: number } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ get user() { return authUserRef.value } }),
}))

const principalsRef = reactive<Array<{ id: number; type: 'user' | 'group'; name: string; user_id?: number; group_id?: number }>>([])
const principalsLoadMock = vi.fn().mockResolvedValue([])
vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => ({
    get principals() { return principalsRef },
    load: principalsLoadMock,
  }),
}))

const { transferAgentMock } = vi.hoisted(() => ({ transferAgentMock: vi.fn() }))
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({ transferAgent: transferAgentMock }),
}))

import AgentOwnershipSection from '@/components/agent/settings/AgentOwnershipSection.vue'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types/agent'

// Slot-revealing Modal stub: renders the default + footer slots inline
// so the dialog body / footer template branches are covered even though
// we don't bring up a real Teleport target.
const ModalSlotStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size', 'backdropClosable'],
  template: `
    <div v-if="modelValue" class="modal-slot-stub">
      <slot />
      <slot name="footer" />
    </div>
  `,
}

const userOwnedAgent = (): Agent => ({
  id: 7,
  name: 'My Bot',
  description: null,
  system_prompt: null,
  llm_driver_config_id: null,
  max_steps: 5,
  is_active: true,
  tools: [],
  notes: null,
  principal_id: 10,
  principal: { id: 10, type: 'user', name: 'Alice', user_id: 1, group_id: null },
})

const groupOwnedAgent = (): Agent => ({
  id: 8,
  name: 'Group Bot',
  description: null,
  system_prompt: null,
  llm_driver_config_id: null,
  max_steps: 5,
  is_active: true,
  tools: [],
  notes: null,
  principal_id: 20,
  principal: { id: 20, type: 'group', name: 'Engineering', user_id: null, group_id: 5 },
})

beforeEach(() => {
  setActivePinia(createPinia())
  principalsRef.splice(0, principalsRef.length)
  authUserRef.value = null
  transferAgentMock.mockReset()
  transferAgentMock.mockResolvedValue(undefined)
  principalsLoadMock.mockReset()
  principalsLoadMock.mockResolvedValue([])
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('AgentOwnershipSection', () => {
  it('renders the current owner chip via OwnerBadge', () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    expect(wrapper.find('.owner-badge').exists()).toBe(true)
  })

  it('hides the Transfer button when the caller has no alternative principals', () => {
    authUserRef.value = { id: 1 }
    principalsRef.push({ id: 10, type: 'user', name: 'Alice', user_id: 1 })
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    expect(wrapper.find('[data-testid="open-transfer-dialog"]').exists()).toBe(false)
  })

  it('shows the Transfer button when at least one alternative principal is available', () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    expect(wrapper.find('[data-testid="open-transfer-dialog"]').exists()).toBe(true)
  })

  it('clicking the Transfer button opens the dialog and resets prior state', async () => {
    // openTransfer is the section's only entry into the Modal — without
    // a click test the function definition is uncovered.
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      // Modal stub exposes the default + footer slots so the dialog
      // body / footer template branches are exercised.
      global: { stubs: { Icon: true, Modal: ModalSlotStub } },
    })
    // Pre-pollute state so we can verify the reset on open.
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = 99
    wrapper.vm.transferError = 'stale error'

    await wrapper.find('[data-testid="open-transfer-dialog"]').trigger('click')
    expect(wrapper.vm.showTransfer).toBe(true)
    expect(wrapper.vm.transferTargetPrincipalId).toBe(null)
    expect(wrapper.vm.transferError).toBe(null)
  })

  it('clicking Cancel closes the dialog', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: ModalSlotStub } },
    })
    wrapper.vm.showTransfer = true
    await flushPromises()

    const cancel = wrapper.findAll('button').find((b) => b.text().trim() === 'Cancel')
    expect(cancel).toBeTruthy()
    await cancel!.trigger('click')
    expect(wrapper.vm.showTransfer).toBe(false)
  })

  it('renders the dialog body (target select + error) when the Modal is open', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: ModalSlotStub } },
    })
    wrapper.vm.showTransfer = true
    wrapper.vm.transferError = 'something went wrong'
    await flushPromises()

    // The target select renders with options for each available principal,
    // labelled via principalLabel. The error message renders when set.
    const select = wrapper.find('[data-testid="transfer-target"]')
    expect(select.exists()).toBe(true)
    const optionLabels = select.findAll('option').map((o) => o.text())
    expect(optionLabels).toContain('— Select a principal —')
    expect(optionLabels).toContain('Group · Engineering')
    expect(wrapper.find('[data-testid="transfer-error"]').text()).toBe('something went wrong')

    // Cancel button is present and clickable, and Transfer is disabled
    // while no target is selected.
    expect(wrapper.findAll('button').some((b) => b.text().trim() === 'Cancel')).toBe(true)
    expect(
      wrapper.findAll('button').find((b) => b.text().trim() === 'Transfer')!.attributes('disabled'),
    ).toBeDefined()
  })

  it('enables the Transfer button once a target is selected', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: ModalSlotStub } },
    })
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = 20
    await flushPromises()

    const transfer = wrapper.findAll('button').find((b) => b.text().trim() === 'Transfer')
    expect(transfer!.attributes('disabled')).toBeUndefined()
  })

  it('excludes the current owner from the dropdown options', () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    const ids = wrapper.vm.transferOptions.map((p: { id: number }) => p.id)
    expect(ids).toEqual([20])
  })

  it('labels group options "Group · {name}" and user options "You ({name})"', () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
      { id: 30, type: 'group', name: 'Ops', group_id: 6 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    expect(wrapper.vm.principalLabel({ id: 20, type: 'group', name: 'Engineering' })).toBe('Group · Engineering')
    expect(wrapper.vm.principalLabel({ id: 30, type: 'group', name: 'Ops' })).toBe('Group · Ops')
    // The current user's principal is excluded from the dropdown entirely,
    // but the helper itself must still produce a sensible label if called.
    expect(wrapper.vm.principalLabel({ id: 10, type: 'user', name: 'Alice' })).toBe('You (Alice)')
  })

  it('confirm calls transferAgent(id, principalId) and closes the dialog', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    transferAgentMock.mockResolvedValueOnce({} as never)
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = 20
    await wrapper.vm.performTransfer()
    // The store action owns the POST + the optimistic agents/currentAgent
    // updates. The component just calls it and surfaces the toast.
    expect(transferAgentMock).toHaveBeenCalledWith(7, 20)
    expect(toastMock.success).toHaveBeenCalledWith('Agent ownership transferred.')
    expect(wrapper.vm.showTransfer).toBe(false)
  })

  it('surfaces ApiError via the inline error and keeps the dialog open', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    transferAgentMock.mockRejectedValueOnce(new ApiError('pending tasks', 'ERROR', 409))
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = 20
    await wrapper.vm.performTransfer()
    expect(wrapper.vm.transferError).toBe('pending tasks')
    expect(wrapper.vm.showTransfer).toBe(true)
  })

  it('returns early without calling the store when no target is selected', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', group_id: 5 },
    )
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = null
    await wrapper.vm.performTransfer()
    expect(transferAgentMock).not.toHaveBeenCalled()
  })

  it('loads principals on mount when the store is empty', async () => {
    authUserRef.value = { id: 1 }
    mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    await flushPromises()
    expect(principalsLoadMock).toHaveBeenCalledTimes(1)
  })

  it('does not refetch principals on mount when the store already has them', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push({ id: 10, type: 'user', name: 'Alice', user_id: 1 })
    mount(AgentOwnershipSection, {
      props: { agent: userOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    await flushPromises()
    expect(principalsLoadMock).not.toHaveBeenCalled()
  })

  it('works the other way: transferring a group-owned agent to the caller', async () => {
    authUserRef.value = { id: 1 }
    principalsRef.push(
      { id: 10, type: 'user', name: 'Alice', user_id: 1 },
      { id: 20, type: 'group', name: 'Engineering', user_id: null, group_id: 5 },
    )
    transferAgentMock.mockResolvedValueOnce({} as never)
    const wrapper = mount(AgentOwnershipSection, {
      props: { agent: groupOwnedAgent() },
      global: { stubs: { Icon: true, Modal: true } },
    })
    // Group is current owner → user-principal is the only option.
    const ids = wrapper.vm.transferOptions.map((p: { id: number }) => p.id)
    expect(ids).toEqual([10])
    wrapper.vm.showTransfer = true
    wrapper.vm.transferTargetPrincipalId = 10
    await wrapper.vm.performTransfer()
    expect(transferAgentMock).toHaveBeenCalledWith(8, 10)
  })
})
