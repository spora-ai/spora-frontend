/**
 * AgentNotesSection — markdown notes form + save flow.
 *
 * Notes are also readable/writable by the agent itself via the `agent` tool's
 * `read_notes` / `write_notes` operations. Operator-side edits go through
 * PATCH /agents/{id} — same shape as AgentIdentitySection, only the payload
 * surface differs.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
  api: { patch: vi.fn(), get: vi.fn() },
}))

import { api } from '@/api/client'
import AgentNotesSection from '@/components/agent/settings/AgentNotesSection.vue'

const patchMock = api.patch as ReturnType<typeof vi.fn>

const baseAgent = {
  id: 1,
  name: 'Test Agent',
  notes: '# existing notes\n\n- alpha\n- beta',
}

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({})
})

describe('AgentNotesSection', () => {
  it('renders the heading and save button', () => {
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    expect(wrapper.text()).toContain('Notes')
    expect(wrapper.find('[data-testid="save-notes"]').exists()).toBe(true)
  })

  it('seeds the editor with the agent.notes value', () => {
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    // The notes value is exposed via form.notes; assert it round-trips through
    // buildIdentityPayload (verified separately in useAgentSettingsForm.spec).
    const vm = wrapper.vm as unknown as { form: { notes: string } }
    expect(vm.form.notes).toBe('# existing notes\n\n- alpha\n- beta')
  })

  it('rebuilds the form when the agent prop changes', async () => {
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.setProps({
      agent: { ...baseAgent, notes: 'replaced' },
      agentId: 1,
    })
    const vm = wrapper.vm as unknown as { form: { notes: string } }
    expect(vm.form.notes).toBe('replaced')
  })

  it('sends PATCH /agents/{id} with the notes payload and shows Saved!', async () => {
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 42 },
    })
    await wrapper.find('[data-testid="save-notes"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/42', expect.objectContaining({
      notes: '# existing notes\n\n- alpha\n- beta',
    }))
    expect(wrapper.find('[data-testid="notes-saved"]').exists()).toBe(true)
  })

  it('shows the generic fallback message for non-ApiError rejections', async () => {
    patchMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-notes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="notes-error"]').text()).toBe('Failed to save.')
  })

  it('uses ApiError.message when an ApiError is thrown', async () => {
    const { ApiError } = await import('@/api/client')
    patchMock.mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'notes too long'))
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-notes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="notes-error"]').text()).toBe('notes too long')
  })

  it('coerces empty notes to null in the payload', async () => {
    const wrapper = mount(AgentNotesSection, {
      props: { agent: { ...baseAgent, notes: '' }, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-notes"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({
      notes: null,
    }))
  })

  it('disables the save button while saving', async () => {
    patchMock.mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))
    const wrapper = mount(AgentNotesSection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-notes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="save-notes"]').attributes('disabled')).toBeDefined()
  })
})