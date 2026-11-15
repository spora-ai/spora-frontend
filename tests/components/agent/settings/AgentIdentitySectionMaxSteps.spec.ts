/**
 * The "Max Steps" input follows the instance's ceiling.
 *
 * The bound is `SPORA_MAX_STEPS` on the backend, and it reaches the SPA
 * through the runtime config — the admin settings are admin-only, and a
 * plain user editing their own agent cannot read the bound there. A
 * hard-coded 100 would refuse a value the server accepts.
 */
import { mount } from '@vue/test-utils'
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

import AgentIdentitySection from '@/components/agent/settings/AgentIdentitySection.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'

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
})

describe('the Max Steps input and the instance ceiling', () => {
  it('bounds the input by the ceiling the runtime config carries', () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.maxAgentSteps = 250

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent }, agentId: 1 },
    })

    expect(maxStepsInput(wrapper).getAttribute('max')).toBe('250')
  })

  it('names the ceiling in the helper text', () => {
    const runtimeConfig = useRuntimeConfigStore()
    runtimeConfig.maxAgentSteps = 250

    const wrapper = mount(AgentIdentitySection, {
      props: { agent: { ...baseAgent }, agentId: 1 },
    })

    expect(wrapper.text()).toContain('250')
  })
})
