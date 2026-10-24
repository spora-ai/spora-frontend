/**
 * TaskChatScrollToBottom — the "jump to the newest message" control.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TaskChatScrollToBottom from '@/components/agent/TaskChat/TaskChatScrollToBottom.vue'

describe('TaskChatScrollToBottom', () => {
  it('offers a labelled control', () => {
    const wrapper = mount(TaskChatScrollToBottom)

    const button = wrapper.find('[data-testid="chat-scroll-to-bottom"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Jump to the latest message')
  })

  it('asks for the newest message when it is clicked', async () => {
    const wrapper = mount(TaskChatScrollToBottom)

    await wrapper.find('[data-testid="chat-scroll-to-bottom"]').trigger('click')

    expect(wrapper.emitted('resume')).toHaveLength(1)
  })

  it('floats over the transcript instead of taking a row of its own', () => {
    const wrapper = mount(TaskChatScrollToBottom)

    // The chat scrolls in the layout's scroll surface, so the control has
    // to stick to the bottom of the visible area — an absolute position
    // would leave it at the end of the whole transcript. It takes no height
    // of its own, so the transcript does not move for it.
    expect(wrapper.classes()).toContain('sticky')
    expect(wrapper.classes()).toContain('h-0')
  })
})
