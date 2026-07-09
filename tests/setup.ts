// Vitest global setup - mocks for browser APIs not available in happy-dom
import { vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Provide an active Pinia instance for every test so that any component
// (or composable) that calls a `useXxxStore()` inside `setup()` can resolve
// its store without throwing "no active Pinia".
beforeEach(() => {
  setActivePinia(createPinia())
})

// Mock `md-editor-v3` so tests don't try to fetch highlight.js / katex /
// mermaid / cropper CSS from unpkg.com (happy-dom's fetch implementation
// either times out or fails) and don't try to mount a real CodeMirror 6
// editor. The mock renders a contenteditable <div> that supports v-model
// and forwards keydown events so consumers can still exercise their
// submit-keyword logic.
//
// `execCommand` is exposed via setup()'s `expose(...)` so consumers can
// call it via the template ref (e.g. `MarkdownEditor`'s bubble-mode
// formatting handler). The real library exposes the same method on its
// public instance.
const execCommandCalls: string[] = []
;(globalThis as unknown as { __mdEditorMockCalls: string[] }).__mdEditorMockCalls = execCommandCalls

vi.mock('md-editor-v3', async () => {
  const { defineComponent, h } = await import('vue')

  const MdEditor = defineComponent({
    name: 'MdEditor',
    // `id` (and any other non-prop HTML attribute that consumers pass)
    // must NOT fall through to the outer wrapper div — the real library
    // applies it to the editable surface so a wrapping <label for="...">
    // can focus the editor. Without inheritAttrs: false, Vue would place
    // the id on our mock root and shadow the inner spread.
    inheritAttrs: false,
    props: [
      'modelValue',
      'theme',
      'style',
      'toolbars',
      'floatingToolbars',
      'footers',
      'preview',
      'placeholder',
      'maxLength',
      'disabled',
      'showToolbarName',
      'language',
      'id',
    ],
    emits: ['update:modelValue', 'onChange', 'keydown'],
    setup(props, { emit, expose }) {
      // Mode is derived from `toolbars` — empty array = bubble mode.
      const isBubble = () => Array.isArray(props.toolbars) && props.toolbars.length === 0
      // Expose a stub execCommand so MarkdownEditor's onBubbleFormat can be
      // exercised in tests. The real library wraps a CodeMirror command.
      // Calls are recorded on the global mock-calls array.
      const calls = (globalThis as { __mdEditorMockCalls?: string[] }).__mdEditorMockCalls ?? []
      const execCommand = (cmd: string) => {
        calls.push(cmd)
      }
      expose({ execCommand })
      return () => {
        const value = (props.modelValue as string) ?? ''
        const placeholder = (props.placeholder as string) ?? ''
        const disabled = Boolean(props.disabled)
        const bubble = isBubble()
        return h('div', {
          class: ['md-editor-mock', bubble ? 'md-editor-mock--bubble' : 'md-editor-mock--full'],
          'data-testid': bubble ? 'markdown-editor-bubble' : 'markdown-editor-full',
          'data-mode': bubble ? 'bubble' : 'full',
          'data-toolbars': JSON.stringify(props.toolbars ?? []),
          'data-floating-toolbars': JSON.stringify(props.floatingToolbars ?? []),
          'data-preview': String(props.preview ?? false),
        }, [
          h('div', {
            class: 'md-editor-input',
            contenteditable: disabled ? 'false' : 'true',
            // The real library applies `id` (and other attrs passed to
            // <MdEditor>) to the editable surface so a wrapping
            // <label for="..."> can label/focus the editor. Mirror that.
            id: props.id,
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-label': placeholder,
            'data-placeholder': placeholder,
            onInput: (e: Event) => {
              if (disabled) return
              const target = e.target as HTMLElement
              const text = target.innerText ?? ''
              emit('update:modelValue', text)
            },
            onKeydown: (e: KeyboardEvent) => {
              emit('keydown', e)
            },
          }, value),
        ])
      }
    },
  })

  return { MdEditor }
})

// Stub navigator.clipboard so `copyCode.ts` (and any other module that
// writes to the clipboard) can be exercised in tests without a real
// clipboard. The test for the copy-to-code action asserts on this mock.
if (typeof navigator === 'undefined' || !navigator.clipboard) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
    configurable: true,
    writable: true,
  })
} else {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  })
}

globalThis.EventSource = class EventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  url: string
  readyState = EventSource.CONNECTING

  constructor(url: string) {
    this.url = url
    // Simulate async connection
    setTimeout(() => {
      this.readyState = EventSource.OPEN
    }, 0)
  }

  close() {
    this.readyState = EventSource.CLOSED
  }
}