/**
 * StatusBadge — task status pill.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import StatusBadge from '@/components/ui/StatusBadge.vue'

describe('StatusBadge', () => {
  it('renders PENDING with neutral classes and label', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'PENDING' } })
    expect(wrapper.classes()).toContain('bg-zinc-100')
    expect(wrapper.text()).toBe('Pending')
  })

  it('renders RUNNING with blue classes', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'RUNNING' } })
    expect(wrapper.classes()).toContain('bg-blue-100')
    expect(wrapper.text()).toBe('Running')
  })

  it('does not animate the dot unless pulse=true', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'RUNNING' } })
    expect(wrapper.find('.animate-pulse').exists()).toBe(false)
  })

  it('animates the dot when pulse=true and status=RUNNING', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'RUNNING', pulse: true } })
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
  })

  it('renders COMPLETED with green classes', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'COMPLETED' } })
    expect(wrapper.classes()).toContain('bg-green-100')
    expect(wrapper.text()).toBe('Completed')
  })

  it('renders FAILED with red classes', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'FAILED' } })
    expect(wrapper.classes()).toContain('bg-red-100')
    expect(wrapper.text()).toBe('Failed')
  })

  it('renders PENDING_APPROVAL with amber classes and static dot', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'PENDING_APPROVAL' } })
    expect(wrapper.classes()).toContain('bg-amber-100')
    expect(wrapper.text()).toBe('Awaiting Approval')
    expect(wrapper.find('.bg-amber-500').exists()).toBe(true)
  })

  it('renders CANCELLED with muted classes', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'CANCELLED' } })
    expect(wrapper.text()).toBe('Cancelled')
  })
})