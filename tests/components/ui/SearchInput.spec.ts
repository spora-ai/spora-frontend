/**
 * SearchInput — magnifying-glass input with clear button.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import SearchInput from '@/components/ui/SearchInput.vue'

describe('SearchInput', () => {
  it('renders a search input with the supplied placeholder', () => {
    const wrapper = mount(SearchInput, {
      props: { modelValue: '', placeholder: 'Find agents…' },
    })
    const input = wrapper.get('input[role="searchbox"]')
    expect(input.attributes('placeholder')).toBe('Find agents…')
    expect(input.attributes('role')).toBe('searchbox')
  })

  it('emits update:modelValue when the user types', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '' } })
    const input = wrapper.get('input[role="searchbox"]')
    await input.setValue('hello')
    const updates = wrapper.emitted('update:modelValue')
    expect(updates).toBeTruthy()
    expect(updates?.[0]).toEqual(['hello'])
  })

  it('shows the clear button when value is non-empty and clears on click', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: 'agent' } })
    const clearBtn = wrapper.find('button[aria-label="Clear search"]')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    const updates = wrapper.emitted('update:modelValue')
    expect(updates?.[0]).toEqual([''])
  })

  it('hides the clear button when value is empty', () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '' } })
    expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(false)
  })
})