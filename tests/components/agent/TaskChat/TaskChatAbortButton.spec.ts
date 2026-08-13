/**
 * TaskChatAbortButton — verifies the abort affordance emits `abort`
 * when clicked and respects the `submitting` disabled state.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import TaskChatAbortButton from '@/components/agent/TaskChat/TaskChatAbortButton.vue'

describe('TaskChatAbortButton', () => {
  it('emits abort on click', async () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: false } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted()).toHaveProperty('abort')
    expect((wrapper.emitted('abort') ?? []).length).toBe(1)
  })

  it('disables the button while submitting is true', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: true } })
    expect((wrapper.find('button').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('is enabled when submitting is false', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: false } })
    expect((wrapper.find('button').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('exposes an aria-label for screen readers', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: false } })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Abort agent loop')
  })

  it('renders the Abort label text', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: false } })
    expect(wrapper.text()).toContain('Abort')
  })
})
