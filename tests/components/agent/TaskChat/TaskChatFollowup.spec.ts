/**
 * TaskChatFollowup — bottom follow-up input bar.
 *
 * Asserts the show/hide behaviour, the input + button wiring, the
 * Enter-to-submit shortcut, and the error rendering.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TaskChatFollowup from '@/components/agent/TaskChat/TaskChatFollowup.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'

// The prompt input is the MarkdownEditor mock's contenteditable surface.
const findPromptInput = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('[contenteditable]')

const setPromptValue = async (wrapper: ReturnType<typeof mount>, value: string) => {
  const input = findPromptInput(wrapper)
  ;(input.element as HTMLElement).innerText = value
  await input.trigger('input')
}

describe('TaskChatFollowup', () => {
  it('does not render when showFollowupBar is false', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: false,
        followupPrompt: '',
        submittingFollowup: false,
        followupError: null,
      },
    })
    expect(wrapper.find('[data-testid="send-followup"]').exists()).toBe(false)
  })

  it('emits updateFollowupPrompt when the textarea changes', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: '',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const textarea = findPromptInput(wrapper)
    await setPromptValue(wrapper, 'hello there')
    expect(wrapper.emitted('updateFollowupPrompt')![0]).toEqual(['hello there'])
  })

  it('disables Send button when prompt is empty or whitespace', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: '   ',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const button = wrapper.find('[data-testid="send-followup"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('disables the Send button when submitting', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: true,
        followupError: null,
      },
    })
    const button = wrapper.find('[data-testid="send-followup"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('emits submitFollowup when Send is clicked', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: null,
      },
    })
    await wrapper.find('[data-testid="send-followup"]').trigger('click')
    expect(wrapper.emitted('submitFollowup')).toBeTruthy()
  })

  it('emits submitFollowup on Cmd+Enter / Ctrl+Enter (matches initial composer)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(wrapper.emitted('submitFollowup')).toBeTruthy()

    const wrapper2 = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: null,
      },
    })
    await findPromptInput(wrapper2).trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(wrapper2.emitted('submitFollowup')).toBeTruthy()
  })

  it('does not emit submitFollowup on plain Enter (inserts a newline)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submitFollowup')).toBeFalsy()
  })

  it('does not emit submitFollowup on Shift+Enter (inserts a newline)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('submitFollowup')).toBeFalsy()
  })

  it('renders followupError message when set', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: 'hi',
        submittingFollowup: false,
        followupError: 'Something went wrong',
      },
    })
    const errorEl = wrapper.find('[data-testid="followup-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe('Something went wrong')
  })

  it('enables auto-grow on the MarkdownEditor and caps at 8 rows', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: {
        showFollowupBar: true,
        followupPrompt: '',
        submittingFollowup: false,
        followupError: null,
      },
    })
    const editor = wrapper.findComponent(MarkdownEditor)
    expect(editor.props('autoGrow')).toBe(true)
    expect(editor.props('maxRows')).toBe(8)
    expect(editor.props('rows')).toBe(1)
  })
})
