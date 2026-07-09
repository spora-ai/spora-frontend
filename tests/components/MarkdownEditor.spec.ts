/**
 * MarkdownEditor — wrapper around md-editor-v3.
 *
 * The underlying library is mocked globally in tests/setup.ts so this
 * spec exercises the wrapper's prop handling, v-model wiring, keydown
 * forwarding, and disabled state without spinning up a real CodeMirror
 * editor.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import MarkdownEditor from '@/components/MarkdownEditor.vue'

describe('MarkdownEditor', () => {
  it('renders with modelValue as the initial content', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'hello', mode: 'full' },
    })
    const root = wrapper.find('[data-testid="markdown-editor-full"]')
    expect(root.exists()).toBe(true)
    expect(wrapper.find('[contenteditable]').text()).toBe('hello')
  })

  it('emits update:modelValue when the user types', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const input = wrapper.find('[contenteditable]')
    ;(input.element as HTMLElement).innerText = 'typed'
    await input.trigger('input')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['typed'])
  })

  it('emits update:modelValue exactly once per input event (no double-emit)', async () => {
    // Regression for Copilot review: the wrapper previously emitted
    // update:modelValue from both the v-model setter and the onChange
    // handler, causing duplicate updates on every keystroke.
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const input = wrapper.find('[contenteditable]')
    ;(input.element as HTMLElement).innerText = 'x'
    await input.trigger('input')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('bubble mode hides the top toolbar (empty toolbars prop)', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'bubble' },
    })
    const root = wrapper.find('[data-testid="markdown-editor-bubble"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('data-mode')).toBe('bubble')
    expect(JSON.parse(root.attributes('data-toolbars') ?? '[]')).toEqual([])
    expect(root.attributes('data-preview')).toBe('false')
  })

  it('full mode exposes the rich toolbar and preview', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const root = wrapper.find('[data-testid="markdown-editor-full"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('data-mode')).toBe('full')
    const toolbars = JSON.parse(root.attributes('data-toolbars') ?? '[]') as string[]
    expect(toolbars).toContain('bold')
    expect(toolbars).toContain('preview')
    expect(toolbars).toContain('table')
    expect(root.attributes('data-preview')).toBe('true')
  })

  it('always exposes a floating selection menu (both modes)', () => {
    const bubble = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'bubble' },
    })
    const bubbleRoot = bubble.find('[data-testid="markdown-editor-bubble"]')
    const bubbleFloating = JSON.parse(bubbleRoot.attributes('data-floating-toolbars') ?? '[]') as string[]
    expect(bubbleFloating).toContain('bold')
    expect(bubbleFloating).toContain('link')

    const full = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const fullRoot = full.find('[data-testid="markdown-editor-full"]')
    const fullFloating = JSON.parse(fullRoot.attributes('data-floating-toolbars') ?? '[]') as string[]
    expect(fullFloating).toContain('bold')
    expect(fullFloating).toContain('link')
  })

  it('renders the placeholder as data-placeholder for accessibility', () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '',
        mode: 'full',
        placeholder: 'Type something…',
      },
    })
    const input = wrapper.find('[contenteditable]')
    expect(input.attributes('data-placeholder')).toBe('Type something…')
    expect(input.attributes('aria-label')).toBe('Type something…')
  })

  it('re-emits keydown events for the consumer to handle submit shortcuts', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const input = wrapper.find('[contenteditable]')
    await input.trigger('keydown', { key: 'Enter', metaKey: true })
    const events = wrapper.emitted('keydown')
    expect(events).toBeTruthy()
    expect((events![0][0] as KeyboardEvent).key).toBe('Enter')
  })

  it('disables the editor when the disabled prop is set', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'locked', mode: 'full', disabled: true },
    })
    const input = wrapper.find('[contenteditable]')
    expect(input.attributes('contenteditable')).toBe('false')
  })

  it('applies an id to the editable surface (labelable), not the wrapper', () => {
    // Regression for Copilot review: the wrapper previously put `id` on its
    // outer <div>, which is not a labelable form control — so <label for="...">
    // would not focus the editor. The id must land on the contenteditable
    // element itself.
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full', id: 'my-editor' },
    })
    const editable = wrapper.find('#my-editor')
    expect(editable.exists()).toBe(true)
    // The wrapper div has the `md-editor-spora` class — make sure the id did
    // NOT land there (regression check for the original Copilot finding).
    expect(wrapper.find('.md-editor-spora#my-editor').exists()).toBe(false)
    // The element carrying the id is the contenteditable surface (not the
    // outer wrapper), so a wrapping <label for="my-editor"> will focus it.
    expect(editable.classes()).toContain('md-editor-input')
    expect(editable.element.hasAttribute('contenteditable')).toBe(true)
  })

  it('auto theme follows the global theme store', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '', mode: 'full' },
    })
    const root = wrapper.find('[data-testid="markdown-editor-full"]')
    expect(root.exists()).toBe(true)
    // Sanity: the wrapper resolves a theme without throwing. The actual
    // theme value is forwarded to MdEditor (not asserted here because the
    // mock component doesn't read it).
    await flushPromises()
  })
})