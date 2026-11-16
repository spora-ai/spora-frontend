/**
 * The "Max Steps" input follows the instance's ceiling.
 *
 * The bound is `SPORA_MAX_STEPS` on the backend, and it reaches the SPA
 * through the runtime config — the admin settings are admin-only, and a
 * plain user editing their own agent cannot read the bound there. A
 * hard-coded 100 would refuse a value the server accepts.
 *
 * The bound has to reach the value that is *sent*, not only the one the
 * browser marks invalid: the form saves on a click rather than on a
 * submit, so the browser never enforces the input's `max`, and a stored
 * cap above the ceiling would travel to the server and be refused there —
 * taking every other field's edit down with it.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message)
      this.name = 'ApiError'
    }
  },
  api: { patch: vi.fn(), get: vi.fn() },
}))

import { api } from '@/api/client'
import AgentIdentitySection from '@/components/agent/settings/AgentIdentitySection.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'

const patchMock = api.patch as ReturnType<typeof vi.fn>

const baseAgent = {
  id: 1,
  name: 'Test Agent',
  description: 'desc',
  system_prompt: 'be helpful',
  max_steps: 10,
  allow_followup: true,
  retry_after_minutes: 0,
  max_retries: 0,
  voice_message_retention_count: 5,
}

function maxStepsInput(wrapper: ReturnType<typeof mount>): HTMLInputElement {
  const input = wrapper.findAll('input[type="number"]').find(
    candidate => candidate.attributes('id')?.includes('max-steps'),
  )

  if (!input) throw new Error('The Max Steps input was not rendered.')

  return input.element as HTMLInputElement
}

beforeEach(() => {
  setActivePinia(createPinia())
  clearAgentEffortCache()
  patchMock.mockReset()
  vi.mocked(api.patch).mockResolvedValue({ agent: baseAgent } as never)
})

describe('the Max Steps input and the instance ceiling', () => {
  it('bounds the input by the ceiling the runtime config carries', () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.publishedMaxAgentSteps = 250

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent }, agentId: 1 },
    })

    expect(maxStepsInput(wrapper).getAttribute('max')).toBe('250')
  })

  it('names the ceiling in the helper text', () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.publishedMaxAgentSteps = 250

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent }, agentId: 1 },
    })

    expect(wrapper.text()).toContain('250')
  })

  it('carries a stored cap above the ceiling as the ceiling', async () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.publishedMaxAgentSteps = 50

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent, max_steps: 100 }, agentId: 1 },
    })
    await flushPromises()

    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()

    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({ max_steps: 50 }))
  })

  it('shows the cap it stored', async () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.publishedMaxAgentSteps = 50

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent, max_steps: 100 }, agentId: 1 },
    })
    await flushPromises()

    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()

    expect(maxStepsInput(wrapper).value).toBe('50')
  })

  it('leaves a stored cap alone when the backend published no ceiling', async () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent, max_steps: 500 }, agentId: 1 },
    })
    await flushPromises()

    await wrapper.find('[data-testid="save-identity"]').trigger('click')
    await flushPromises()

    // A backend that publishes no ceiling has no bound to hold the cap to.
    // The default the form displays is not one: clamping against it would
    // quietly lower a cap the backend still accepts.
    expect(patchMock).toHaveBeenCalledWith('/agents/1', expect.objectContaining({ max_steps: 500 }))
  })

  it('shows the default bound when the backend published no ceiling', () => {
    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent }, agentId: 1 },
    })

    expect(maxStepsInput(wrapper).getAttribute('max')).toBe('200')
  })
})
