/**
 * Avatar — initials in a circle.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Avatar from '@/components/ui/Avatar.vue'

describe('Avatar', () => {
  it('renders the supplied initials', () => {
    const wrapper = mount(Avatar, { props: { initials: 'FB' } })
    expect(wrapper.text()).toBe('FB')
  })

  it('uses muted tone by default', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB' } })
    expect(wrapper.classes()).toContain('bg-muted')
    expect(wrapper.classes()).toContain('text-foreground')
  })

  it('switches to primary tone when requested', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB', tone: 'primary' } })
    expect(wrapper.classes()).toContain('bg-foreground')
    expect(wrapper.classes()).toContain('text-background')
  })

  it('applies the requested size class', () => {
    const wrapper = mount(Avatar, { props: { initials: 'AB', size: 'lg' } })
    expect(wrapper.classes()).toContain('h-14')
    expect(wrapper.classes()).toContain('w-14')
  })
})