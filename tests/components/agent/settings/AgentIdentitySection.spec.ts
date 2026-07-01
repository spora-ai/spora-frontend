/**
 * AgentIdentitySection — identity form + save flow.
 *
 * Mounts the component, types into the form, stubs the api.patch call, and
 * asserts the PATCH body + the success/error paths.
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
import AgentIdentitySection from '@/components/agent/settings/AgentIdentitySection.vue'

const patchMock = api.patch as ReturnType<typeof vi.fn>

const baseAgent = {
  id: 1,
  name: 'Test Agent',
  description: 'desc',
  system_prompt: 'be helpful',
  max_steps: 10,
  allow_continuation: true,
  retry_after_minutes: 0,
  max_retries: 0,
}

beforeEach(() => {
  patchMock.mockReset()
  vi.mocked(api.patch).mockReset()
  vi.mocked(api.patch).mockResolvedValue({})
  patchMock.mockResolvedValue({})
})

describe('AgentIdentitySection', () => {
  // Helpers: ids are now scoped via Vue's useId() so they vary per mount.
  // Find the input/textarea whose direct parent contains the label text.
  const inputByLabel = (wrapper: ReturnType<typeof mount>, label: string): HTMLInputElement | HTMLTextAreaElement => {
    const el = wrapper.findAll('input, textarea').find((node) => {
      const parent = (node.element as HTMLElement).parentElement
      const labelEl = parent?.querySelector('label')
      return labelEl?.textContent?.trim().startsWith(label) === true
    })
    if (!el) throw new Error(`no input for label "${label}"`)
    return el.element as HTMLInputElement | HTMLTextAreaElement
  }
  const checkboxByLabel = (wrapper: ReturnType<typeof mount>, label: string): HTMLInputElement => {
    const el = wrapper.findAll('input[type="checkbox"]').find((node) => {
      // The checkbox's grandparent <div class="flex items-start gap-3"> wraps
      // the checkbox + a <div> with the label inside it.
      const grand = (node.element as HTMLElement).parentElement?.parentElement
      return grand?.textContent?.includes(label) === true
    })
    if (!el) throw new Error(`no checkbox for label "${label}"`)
    return el.element as HTMLInputElement
  }

  it('renders all identity fields with initial agent values', () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    expect((inputByLabel(wrapper, 'Name') as HTMLInputElement).value).toBe('Test Agent')
    expect((inputByLabel(wrapper, 'Description') as HTMLInputElement).value).toBe('desc')
    expect((inputByLabel(wrapper, 'System Prompt') as HTMLTextAreaElement).value).toBe('be helpful')
    expect((inputByLabel(wrapper, 'Max Steps') as HTMLInputElement).value).toBe('10')
    expect(checkboxByLabel(wrapper, 'Allow continuation').checked).toBe(true)
  })

  it('disables the save button when name is empty', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent, name: 'Test Agent' }, agentId: 1 },
    })
    const nameInput = wrapper.findAll('input[type="text"]')[0]
    await nameInput.setValue('')
    expect(wrapper.find('[data-testid="save-identity"]').attributes('disabled')).toBeDefined()
  })

  it('sends the right PATCH payload on save and shows Saved!', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 42 },
    })
    const descInput = wrapper.findAll('input[type="text"]').find((i) => i.attributes('placeholder') === 'What does this agent do?')!
    await descInput.setValue('new description')
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/42', {
      name: 'Test Agent',
      description: 'new description',
      system_prompt: 'be helpful',
      max_steps: 10,
      allow_continuation: true,
      retry_after_minutes: 0,
      max_retries: 0,
    })
    expect(wrapper.find('[data-testid="identity-saved"]').exists()).toBe(true)
  })

  it('shows the generic fallback message for non-ApiError rejections', async () => {
    patchMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="identity-error"]').text()).toBe('Failed to save.')
  })

  it('uses ApiError.message when an ApiError is thrown', async () => {
    const { ApiError } = await import('@/api/client')
    patchMock.mockRejectedValueOnce(new ApiError('CONFLICT', 'duplicate name'))
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="identity-error"]').text()).toBe('duplicate name')
  })

  it('coerces empty description / system_prompt to null in the payload', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: {
        agent: { ...baseAgent, description: '', system_prompt: '' },
        agentId: 1,
      },
    })
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({
      description: null,
      system_prompt: null,
    }))
  })

  it('renders retry_after_minutes and max_retries with their initial values', () => {
    const wrapper = mount(AgentIdentitySection, {
      props: {
        agent: { ...baseAgent, retry_after_minutes: 5, max_retries: 3 },
        agentId: 1,
      },
    })
    const numInputs = wrapper.findAll('input[type="number"]')
    // First number input is max-steps, then retry-after-minutes, then max-retries.
    expect(numInputs[1].element.value).toBe('5')
    expect(numInputs[2].element.value).toBe('3')
  })

  it('writes retry_after_minutes and max_retries changes to the PATCH payload', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    const numInputs = wrapper.findAll('input[type="number"]')
    await numInputs[1].setValue('10')
    await numInputs[2].setValue('2')
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({
      retry_after_minutes: 10,
      max_retries: 2,
    }))
  })

  it('rebuilds the form when the agent prop changes', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    await wrapper.setProps({
      agent: { ...baseAgent, name: 'Renamed Agent', max_steps: 25 },
      agentId: 1,
    })
    const textInputs = wrapper.findAll('input[type="text"]')
    expect(textInputs[0].element.value).toBe('Renamed Agent')
    expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('25')
  })

  it('toggles allow_continuation via the checkbox', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: baseAgent, agentId: 1 },
    })
    const checkbox = wrapper.find('input[type="checkbox"]')
    expect(checkbox.element.checked).toBe(true)
    await checkbox.setValue(false)
    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()
    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({
      allow_continuation: false,
    }))
  })
})
