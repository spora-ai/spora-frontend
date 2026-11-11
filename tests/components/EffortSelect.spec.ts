/**
 * EffortSelect — the reasoning-effort picker.
 *
 * Two variants: the labelled pill for the composer, and the icon-only
 * trigger for the follow-up row.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import EffortSelect from '@/components/EffortSelect.vue'
import type { EffortOption } from '@/types/effort'

const LEVELS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
]

const IconStub = {
  name: 'Icon',
  props: ['name'],
  template: '<span class="icon-stub" :data-name="name" />',
}

function mountSelect(props: Record<string, unknown> = {}) {
  return mount(EffortSelect, {
    props: {
      levels: LEVELS,
      modelValue: 'low',
      ...props,
    },
    global: { stubs: { Icon: IconStub } },
  })
}

describe('EffortSelect', () => {
  it('renders the levels and the model default', () => {
    const wrapper = mountSelect()
    const options = wrapper.findAll('option')
    expect(options.map(option => option.text())).toEqual(['Model default', 'Low', 'High'])
  })

  it('shows the chosen level', () => {
    const wrapper = mountSelect({ modelValue: 'high' })
    const select = wrapper.find('[data-testid="effort-select"]')
    expect((select.element as HTMLSelectElement).value).toBe('high')
  })

  it('emits the level the user picked', async () => {
    const wrapper = mountSelect({ modelValue: '' })
    await wrapper.find('[data-testid="effort-select"]').setValue('high')
    expect(wrapper.emitted('update:modelValue')).toEqual([['high']])
  })

  it('emits the model default as an empty string', async () => {
    const wrapper = mountSelect({ modelValue: 'low' })
    await wrapper.find('[data-testid="effort-select"]').setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('labels the pill and gives the select an accessible name', () => {
    const wrapper = mountSelect()
    expect(wrapper.text()).toContain('Effort')
    expect(wrapper.find('[data-testid="effort-select"]').attributes('aria-label')).toBe('Reasoning effort')
  })

  it('ships its own chevron, because `appearance-none` removes the native arrow', () => {
    const wrapper = mountSelect()
    expect(wrapper.find('[data-name="chevron-down"]').exists()).toBe(true)
  })

  describe('the compact variant', () => {
    it('is icon-only — no visible label — and still offers the levels', () => {
      const wrapper = mountSelect({ compact: true })
      expect(wrapper.text()).not.toContain('Effort')
      expect(wrapper.find('[data-name="brain"]').exists()).toBe(true)
      expect(wrapper.findAll('option').map(option => option.text())).toEqual([
        'Model default',
        'Low',
        'High',
      ])
    })

    it('emits the level the user picked', async () => {
      const wrapper = mountSelect({ compact: true, modelValue: 'low' })
      await wrapper.find('[data-testid="effort-select"]').setValue('high')
      expect(wrapper.emitted('update:modelValue')).toEqual([['high']])
    })

    it('names itself for assistive technology', () => {
      const wrapper = mountSelect({ compact: true })
      expect(wrapper.find('[data-testid="effort-select"]').attributes('aria-label')).toBe('Reasoning effort')
    })
  })
})
