/**
 * TaskChatAbortButton — verifies the abort affordance emits `abort`
 * when clicked and respects the `submitting` disabled state.
 *
 * The button gives immediate feedback by flipping its label from
 * "Abort" to "Aborting…" and switching the icon to a spinner while
 * the request is in flight, so the user sees acknowledged input even
 * before the network round-trip resolves.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
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

  it('updates the aria-label while submitting', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: true } })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Aborting agent loop')
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true')
  })

  it('renders the Abort label text', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: false } })
    expect(wrapper.text()).toContain('Abort')
  })

  it('flips the label to Aborting… while submitting so the click is acknowledged immediately', () => {
    const wrapper = mount(TaskChatAbortButton, { props: { submitting: true } })
    expect(wrapper.text()).toContain('Aborting')
  })
})
