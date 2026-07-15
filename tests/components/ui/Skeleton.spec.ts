/**
 * Skeleton — shimmer placeholder block.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Skeleton from '@/components/ui/Skeleton.vue'

describe('Skeleton', () => {
  it('renders a div with the supplied dimensions', () => {
    const wrapper = mount(Skeleton, {
      props: { height: '24px', width: '120px' },
    })
    const el = wrapper.find('div')
    const style = el.attributes('style') ?? ''
    expect(style).toContain('height: 24px')
    expect(style).toContain('width: 120px')
  })

  it('uses rounded-full when rounded=true', () => {
    const wrapper = mount(Skeleton, { props: { rounded: true } })
    expect(wrapper.classes()).toContain('rounded-full')
  })

  it('defaults to rounded-md', () => {
    const wrapper = mount(Skeleton)
    expect(wrapper.classes()).toContain('rounded-md')
    expect(wrapper.classes()).not.toContain('rounded-full')
  })

  it('hides the placeholder from assistive tech', () => {
    const wrapper = mount(Skeleton)
    expect(wrapper.find('div').attributes('aria-hidden')).toBe('true')
  })
})