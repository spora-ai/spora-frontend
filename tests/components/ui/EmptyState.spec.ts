/**
 * EmptyState — centered placeholder with icon + title + description.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import EmptyState from '@/components/ui/EmptyState.vue'

describe('EmptyState', () => {
  it('renders title and description from props', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'No matches', description: 'Try a different filter.' },
    })
    expect(wrapper.text()).toContain('No matches')
    expect(wrapper.text()).toContain('Try a different filter.')
  })

  it('renders default slot content when provided instead of props', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Should be ignored' },
      slots: { default: '<button class="cta-stub">Reset</button>' },
    })
    expect(wrapper.find('.cta-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Should be ignored')
  })

  it('renders the icon slot when provided', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Empty' },
      slots: { icon: '<svg class="custom-icon" data-testid="custom-icon" />' },
    })
    expect(wrapper.find('[data-testid="custom-icon"]').exists()).toBe(true)
  })
})