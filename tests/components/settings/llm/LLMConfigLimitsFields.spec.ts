/**
 * LLMConfigLimitsFields — shared `context_window` + `max_tokens_output`
 * inputs used by both the global settings forms and the agent-scoped
 * AgentLlmConfigModal. Asserts the v-model contract + number-only
 * coercion expected by the backend.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import LLMConfigLimitsFields from '@/components/settings/llm/LLMConfigLimitsFields.vue'

function mountLimits(initial: { context_window: string; max_tokens_output: string } = { context_window: '', max_tokens_output: '' }) {
  return mount(LLMConfigLimitsFields, { props: { modelValue: initial } })
}

describe('LLMConfigLimitsFields', () => {
  it('renders both input fields with the correct labels', () => {
    const wrapper = mountLimits()
    expect(wrapper.text()).toContain('Limits')
    expect(wrapper.text()).toContain('Context window')
    expect(wrapper.text()).toContain('Max output tokens')
  })

  it('renders two number inputs', () => {
    const wrapper = mountLimits()
    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(2)
  })

  it('binds the initial modelValue to the inputs', () => {
    const wrapper = mountLimits({ context_window: '200000', max_tokens_output: '32000' })
    const inputs = wrapper.findAll('input[type="number"]')
    expect((inputs[0].element as HTMLInputElement).value).toBe('200000')
    expect((inputs[1].element as HTMLInputElement).value).toBe('32000')
  })

  it('emits update:modelValue when context_window changes', async () => {
    const wrapper = mountLimits()
    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0].setValue('128000')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ context_window: '128000', max_tokens_output: '' })
  })

  it('emits update:modelValue when max_tokens_output changes', async () => {
    const wrapper = mountLimits({ context_window: '128000', max_tokens_output: '' })
    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[1].setValue('16384')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted![0][0]).toEqual({ context_window: '128000', max_tokens_output: '16384' })
  })

  it('preserves the other field when one is edited (no clobber)', async () => {
    const wrapper = mountLimits({ context_window: '128000', max_tokens_output: '16384' })
    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0].setValue('200000')
    const emitted = wrapper.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1][0]).toEqual({
      context_window: '200000',
      max_tokens_output: '16384',
    })
  })

  it('does not advertise an upper bound in helper text (validation lives server-side)', () => {
    const wrapper = mountLimits()
    // Generic helper text — no specific cap number exposed to the operator.
    expect(wrapper.text()).not.toContain('1,000,000')
    expect(wrapper.text()).not.toContain('1_000_000')
  })

  it('uses min=1 so the HTML layer rejects zero and negative values', () => {
    const wrapper = mountLimits()
    const inputs = wrapper.findAll('input[type="number"]')
    expect((inputs[0].element as HTMLInputElement).min).toBe('1')
    expect((inputs[1].element as HTMLInputElement).min).toBe('1')
  })
})