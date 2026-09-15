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
      // The signature accepts the library's own ToolDirective type so the
      // mock surface matches what consumers see — a wider signature here
      // would mask a real type error downstream.
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

// Stub `SharedWorker` and `Worker` so production code that constructs
// them via `new Worker(new URL(...), { type: 'module' })` can be
// exercised in tests. The real workers run in a separate thread and
// have no test-time substitute; the shims capture the
// `port.onmessage` / `onmessage` handlers so the test can drive
// messages back at the caller and assert on the messages the caller
// posts. They don't actually execute the worker script.
class PortShim {
  onmessage: ((ev: MessageEvent) => void) | null = null
  postMessage(_msg: unknown): void {
    // Tests stub via spy when they need to assert on posted messages.
  }
  start(): void {
    // no-op
  }
  close(): void {
    // no-op
  }
}

;(globalThis as unknown as { SharedWorker: unknown }).SharedWorker = class SharedWorker {
  static lastInstance: SharedWorker
  port: PortShim = new PortShim()
  constructor(_url: string | URL, _opts?: WorkerOptions) {
    ;(this.constructor as unknown as { lastInstance: SharedWorker }).lastInstance = this
  }
}

;(globalThis as unknown as { Worker: unknown }).Worker = class Worker {
  static lastInstance: Worker
  onmessage: ((ev: MessageEvent) => void) | null = null
  constructor(_url: string | URL, _opts?: WorkerOptions) {
    ;(this.constructor as unknown as { lastInstance: Worker }).lastInstance = this
  }
  postMessage(_msg: unknown): void {
    // Tests stub via spy when they need to assert on posted messages.
  }
  terminate(): void {
    // no-op
  }
}

/**
 * MediaRecorder is unavailable in happy-dom. The recording composable
 * (`useAudioRecorder`) probes `MediaRecorder.isTypeSupported` and
 * instantiates one inside `start()`, so component-level tests of
 * `AudioRecorderButton` (and any future consumer) need a substitute.
 *
 * The shim records the constructor args, exposes the same lifecycle
 * hooks the real class raises (`ondataavailable`, `onstop`, `onerror`),
 * and lets the test script fire them via the static `lastInstance`
 * handle. `start()` / `stop()` mutate a `state` field the test can
 * assert on; the test for the happy path also calls
 * `MockMediaRecorder.fireDataAvailable(blob)` + `fireStop()` to drive
 * the composable through its recording → preview transition.
 */
interface MockMediaRecorderControls {
  state: 'inactive' | 'recording' | 'stopped'
  ondataavailable: ((event: BlobEvent) => void) | null
  onstop: (() => void) | null
  onerror: ((event: Event) => void) | null
  start(): void
  stop(): void
}

class MockMediaRecorder implements MockMediaRecorderControls {
  state: 'inactive' | 'recording' | 'stopped' = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {
    const ctor = MockMediaRecorder as unknown as { lastInstance: MockMediaRecorder | null }
    ctor.lastInstance = this
  }

  static isTypeSupported(mime: string): boolean {
    // Only the canonical candidates the production picker probes need to
    // pass; everything else falls back to the browser-default empty string
    // — same behaviour as a vanilla Chromium without `--enable-experimental-web-platform-features`.
    return mime === 'audio/webm;codecs=opus'
      || mime === 'audio/ogg;codecs=opus'
      || mime === 'audio/mp4'
      || mime === 'audio/webm'
      || mime === ''
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state === 'stopped') {
      return
    }
    this.state = 'stopped'
    queueMicrotask(() => {
      this.onstop?.()
    })
  }

  fireDataAvailable(blob: Blob): void {
    this.ondataavailable?.({ data: blob } as unknown as BlobEvent)
  }

  fireError(message: string): void {
    this.onerror?.({ error: new Error(message) } as unknown as Event)
  }
}

;(MockMediaRecorder as unknown as { lastInstance: MockMediaRecorder | null }).lastInstance = null
;(globalThis as unknown as { MediaRecorder: typeof MockMediaRecorder }).MediaRecorder = MockMediaRecorder

/**
 * Stub `navigator.mediaDevices.getUserMedia` so `useAudioRecorder` can
 * obtain a fake `MediaStream`. happy-dom ships a partial
 * MediaStream implementation but no `getUserMedia`, so any consumer
 * that touches the recording composable would otherwise throw on
 * `navigator.mediaDevices.getUserMedia is not a function`.
 *
 * Each call resolves to a fresh `MediaStream` with one track whose
 * `stop()` is captured on the static handle so the test can verify
 * the recorder releases the stream on `dispose()`.
 */
class MockMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live'
  stop(): void {
    this.readyState = 'ended'
  }
}

class MockMediaStream {
  tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]
  getTracks(): MockMediaStreamTrack[] {
    return this.tracks
  }
}

const getUserMediaMock = (): Promise<MediaStream> => {
  return Promise.resolve(new MockMediaStream() as unknown as MediaStream)
}
const getUserMediaSpy = vi.fn(getUserMediaMock)

const mediaDevicesShim = { getUserMedia: getUserMediaSpy }

// Define `mediaDevices` on the existing `navigator` rather than
// replacing the whole object. The previous implementation spread
// `globalThis.navigator` and re-assigned, which silently dropped the
// `userAgent` property under happy-dom's lazy / getter-based nav
// surface — that breaks `vue-draggable-plus` at import time
// (`navigator.userAgent.match(...)`).
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: mediaDevicesShim,
    configurable: true,
    writable: true,
  })
} else {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: '', mediaDevices: mediaDevicesShim },
    configurable: true,
    writable: true,
  })
}

// Expose the spies on `globalThis` so individual tests can introspect
// or reset them. The `__mediaRecorder` and `__getUserMedia` keys are
// namespaced to keep collision risk low.
;(globalThis as unknown as { __mediaRecorder: typeof MockMediaRecorder }).__mediaRecorder = MockMediaRecorder
;(globalThis as unknown as { __getUserMedia: ReturnType<typeof vi.fn> }).__getUserMedia = getUserMediaSpy