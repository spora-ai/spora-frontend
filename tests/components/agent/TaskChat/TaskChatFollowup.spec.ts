/**
 * TaskChatFollowup — bottom follow-up input bar.
 *
 * Asserts the show/hide behaviour, the input + button wiring, the
 * Enter-to-submit shortcut, the error rendering, and the new
 * attachment affordances (chip list, attach buttons).
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

/**
 * Default props for the attachment-enabled component. The pre-attachment
 * tests didn't supply these props; centralising the defaults here keeps
 * each test focused on what it actually asserts.
 */
function baseProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    showFollowupBar: true,
    followupPrompt: '',
    submittingFollowup: false,
    followupError: null,
    attachedMedia: [],
    showMediaPicker: false,
    pickerMediaKind: 'image+document',
    pickerAccept: '',
    imageSupport: 'active',
    uploadError: null,
    composerError: null,
    agentId: 1,
    agentPrincipalId: 1,
    ...overrides,
  }
}

describe('TaskChatFollowup', () => {
  it('does not render when showFollowupBar is false', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ showFollowupBar: false }),
    })
    expect(wrapper.find('[data-testid="send-followup"]').exists()).toBe(false)
  })

  it('emits updateFollowupPrompt when the textarea changes', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps(),
    })
    const textarea = findPromptInput(wrapper)
    await setPromptValue(wrapper, 'hello there')
    expect(wrapper.emitted('updateFollowupPrompt')![0]).toEqual(['hello there'])
  })

  it('disables Send button when prompt is empty or whitespace', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: '   ' }),
    })
    const button = wrapper.find('[data-testid="send-followup"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('disables the Send button when submitting', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi', submittingFollowup: true }),
    })
    const button = wrapper.find('[data-testid="send-followup"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('emits submitFollowup when Send is clicked', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi' }),
    })
    await wrapper.find('[data-testid="send-followup"]').trigger('click')
    expect(wrapper.emitted('submitFollowup')).toBeTruthy()
  })

  it('emits submitFollowup on Cmd+Enter / Ctrl+Enter (matches initial composer)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi' }),
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(wrapper.emitted('submitFollowup')).toBeTruthy()

    const wrapper2 = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi' }),
    })
    await findPromptInput(wrapper2).trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(wrapper2.emitted('submitFollowup')).toBeTruthy()
  })

  it('does not emit submitFollowup on plain Enter (inserts a newline)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi' }),
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submitFollowup')).toBeFalsy()
  })

  it('does not emit submitFollowup on Shift+Enter (inserts a newline)', async () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi' }),
    })
    const textarea = findPromptInput(wrapper)
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('submitFollowup')).toBeFalsy()
  })

  it('renders composerError when the submit fails server-side', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({ followupPrompt: 'hi', composerError: 'Something went wrong' }),
    })
    const errorEl = wrapper.find('[data-testid="followup-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe('Something went wrong')
  })

  it('renders composerError when the upload guard short-circuits the submit', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps({
        followupPrompt: 'hi',
        composerError: 'This LLM does not support image attachments.',
      }),
    })
    const errorEl = wrapper.find('[data-testid="followup-error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe('This LLM does not support image attachments.')
  })

  it('enables auto-grow on the MarkdownEditor and caps at 10 rows', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps(),
    })
    const editor = wrapper.findComponent(MarkdownEditor)
    expect(editor.props('autoGrow')).toBe(true)
    expect(editor.props('maxRows')).toBe(10)
    expect(editor.props('rows')).toBe(1)
  })

  it('shows the platform-appropriate submit shortcut in the placeholder', () => {
    const wrapper = mount(TaskChatFollowup, {
      props: baseProps(),
    })
    const editor = wrapper.findComponent(MarkdownEditor)
    // Vitest's happy-dom defaults to a Linux-like UA, so we expect Ctrl.
    expect(editor.props('placeholder')).toContain('Ctrl+Enter')
    expect(editor.props('placeholder')).not.toContain('Cmd+Enter')
  })

  describe('attach buttons', () => {
    it('emits requestOpenPicker with "image+document" when the paperclip is clicked', async () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps(),
      })
      await wrapper.find('[data-testid="followup-attach-file"]').trigger('click')
      expect(wrapper.emitted('requestOpenPicker')![0]).toEqual(['image+document'])
    })

    it('emits requestOpenPicker with "image" when the image button is clicked (vision-capable agent)', async () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps({ imageSupport: 'active' }),
      })
      await wrapper.find('[data-testid="followup-attach-image"]').trigger('click')
      expect(wrapper.emitted('requestOpenPicker')![0]).toEqual(['image'])
    })

    it('disables the image button when the agent LLM does not support images', () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps({ imageSupport: 'unsupported' }),
      })
      const button = wrapper.find('[data-testid="followup-attach-image"]')
      expect(button.attributes('disabled')).toBeDefined()
    })
  })

  describe('attachment chips', () => {
    it('does not render the chip container when attachedMedia is empty', () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps({ attachedMedia: [] }),
      })
      expect(wrapper.find('[data-testid="followup-attachment-chips"]').exists()).toBe(false)
    })

    it('renders one chip per staged attachment', () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps({
          attachedMedia: [
            { id: 'a', filename: 'a.png', media_type: 'image', mime_type: 'image/png', byte_size: 1, asset_url: '/a', has_markdown: false },
            { id: 'b', filename: 'b.pdf', media_type: 'document', mime_type: 'application/pdf', byte_size: 1, asset_url: '/b', has_markdown: false },
          ],
        }),
      })
      const chips = wrapper.findAll('[data-testid="followup-attachment-chips"] > span')
      expect(chips.length).toBe(2)
    })

    it('emits removeAttachment when a chip × is clicked', async () => {
      const wrapper = mount(TaskChatFollowup, {
        props: baseProps({
          attachedMedia: [
            { id: 'a', filename: 'a.png', media_type: 'image', mime_type: 'image/png', byte_size: 1, asset_url: '/a', has_markdown: false },
          ],
        }),
      })
      await wrapper.find('[data-testid="followup-remove-attachment"]').trigger('click')
      expect(wrapper.emitted('removeAttachment')![0]).toEqual(['a'])
    })
  })
})
