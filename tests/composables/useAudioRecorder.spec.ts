/**
 * useAudioRecorder — MediaRecorder wrapper for the composer's voice input.
 *
 * Drives the composable through its state machine via the global
 * MediaRecorder shim installed in `tests/setup.ts` and the
 * `navigator.mediaDevices.getUserMedia` spy. The mock surface lets us
 * assert on the constructor args (MIME negotiation), the recorded
 * lifecycle hooks, and the resource release on `dispose()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onScopeDispose, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  useAudioRecorder,
  pickSupportedMimeType,
  type UseAudioRecorderOptions,
} from '@/composables/useAudioRecorder'

interface Captured {
  start: ReturnType<typeof useAudioRecorder>
  dispose: () => void
}

function mountHarness(): Captured {
  return mountHarnessWithOptions({})
}

function mountHarnessWithOptions(options: UseAudioRecorderOptions): Captured {
  let captured: ReturnType<typeof useAudioRecorder> | null = null
  let disposeFn: (() => void) | null = null

  const Harness = defineComponent({
    setup() {
      captured = useAudioRecorder(options)
      onScopeDispose(() => {
        disposeFn?.()
      })
      return () => h('div')
    },
  })

  const wrapper = mount(Harness)
  if (captured === null) {
    throw new Error('useAudioRecorder was not invoked during harness setup')
  }
  const handles = captured
  disposeFn = (): void => {
    handles.dispose()
  }
  return {
    start: handles,
    dispose: (): void => {
      wrapper.unmount()
    },
  }
}

const MockMediaRecorder = (globalThis as unknown as {
  __mediaRecorder: typeof import('@vue/test-utils').mount extends never ? unknown : never
  // Fallback: the shim installed in tests/setup.ts is reachable via globalThis.
}).__mediaRecorder as unknown as {
  lastInstance: {
    state: 'inactive' | 'recording' | 'stopped'
    options?: MediaRecorderOptions
    stream: { getTracks(): Array<{ stop(): void, readyState: 'live' | 'ended' }> }
    ondataavailable: ((event: { data: Blob }) => void) | null
    onstop: (() => void) | null
    onerror: ((event: { error: Error }) => void) | null
    fireDataAvailable(blob: Blob): void
    fireError(message: string): void
  } | null
  isTypeSupported(mime: string): boolean
}

const getUserMediaSpy = (globalThis as unknown as { __getUserMedia?: ReturnType<typeof vi.fn> }).__getUserMedia

function makeBlob(): Blob {
  return new Blob(['x'.repeat(16)], { type: 'audio/webm' })
}

beforeEach(() => {
  MockMediaRecorder.lastInstance = null
  getUserMediaSpy?.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAudioRecorder', () => {
  it('starts in the idle state with no blob', () => {
    const { start, dispose } = mountHarness()
    expect(start.state.value).toBe('idle')
    expect(start.audioBlob.value).toBeNull()
    expect(start.elapsedMs.value).toBe(0)
    dispose()
  })

  it('start() requests a media stream and constructs a MediaRecorder with the chosen MIME', async () => {
    const { start, dispose } = mountHarness()
    await start.start()
    expect(getUserMediaSpy).toHaveBeenCalledTimes(1)
    expect(MockMediaRecorder.lastInstance).not.toBeNull()
    expect(MockMediaRecorder.lastInstance?.state).toBe('recording')
    expect(start.state.value).toBe('recording')
    dispose()
  })

  it('start() passes the highest-priority MIME that the recorder supports', async () => {
    const { start, dispose } = mountHarness()
    await start.start()
    expect(MockMediaRecorder.lastInstance?.options?.mimeType).toBe('audio/webm;codecs=opus')
    dispose()
  })

  it('start() forwards preferredMimes into the MediaRecorder constructor (integrated path)', async () => {
    // This test exists because the original `pickSupportedMimeType`
    // unit-level tests don't catch stale-closure bugs in the wiring
    // that hands the option through. MiniMax-shape: OGG > MP4 > WebM.
    const { start, dispose } = mountHarnessWithOptions({
      preferredMimes: ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus'],
    })
    await start.start()
    expect(MockMediaRecorder.lastInstance?.options?.mimeType).toBe('audio/ogg;codecs=opus')
    dispose()
  })

  it('start() re-evaluates a preferredMimes getter on every call (no stale closure)', async () => {
    // The capability probe in useSpeechCapability is lazy — it lands
    // on first use, well after component setup. The composable must
    // re-read the ref / getter on every start(), not capture its
    // value at construction. First start() with `null` (capability
    // hasn't landed) should pick the WebM-first default; flipping
    // the ref to a MiniMax-shape list and starting again should pick
    // OGG-over-Opus.
    const preference: Ref<readonly string[] | null> = ref(null)

    let recorder: ReturnType<typeof useAudioRecorder> | null = null
    let disposeFn: (() => void) | null = null
    const Harness = defineComponent({
      setup() {
        recorder = useAudioRecorder({ preferredMimes: preference })
        onScopeDispose(() => disposeFn?.())
        return () => h('div')
      },
    })
    const wrapper = mount(Harness)
    if (recorder === null) {
      throw new Error('useAudioRecorder was not invoked')
    }
    disposeFn = (): void => {
      recorder?.dispose()
    }

    await recorder.start()
    expect(MockMediaRecorder.lastInstance?.options?.mimeType).toBe('audio/webm;codecs=opus')

    // Tear down the first recording and flip the ref to a
    // MiniMax-shape list. The next start() must pick up the new
    // value — proves the composable doesn't capture options at
    // construction time (which was the bug the AudioRecorderButton
    // saw when the capability probe was still empty at setup).
    const firstRecorder = MockMediaRecorder.lastInstance
    if (firstRecorder === null) {
      throw new Error('MediaRecorder shim was not invoked on first start')
    }
    firstRecorder.fireDataAvailable(makeBlob())
    await recorder.stop()

    preference.value = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus']
    MockMediaRecorder.lastInstance = null
    await recorder.start()
    expect(MockMediaRecorder.lastInstance?.options?.mimeType).toBe('audio/ogg;codecs=opus')

    disposeFn?.()
    wrapper.unmount()
  })

  it('pickSupportedMimeType() prefers opus-encoded containers', () => {
    expect(pickSupportedMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('pickSupportedMimeType() honours a caller-supplied preference list (MiniMax: OGG > MP4 > WebM)', () => {
    // The active STT provider's `preferred_audio_mimes` (surfaced by
    // /api/v1/speech/capability) rewrites the probe order. MiniMax
    // rejects the Matroska/WebM container with HTTP 502 (error 2013)
    // so its preference list starts with OGG/Opus — Chrome 105+
    // records it natively.
    expect(pickSupportedMimeType([
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/webm;codecs=opus',
    ])).toBe('audio/ogg;codecs=opus')
  })

  it('pickSupportedMimeType() falls back to the WebM-first default when the preference list is empty', () => {
    expect(pickSupportedMimeType([])).toBe('audio/webm;codecs=opus')
    expect(pickSupportedMimeType(null)).toBe('audio/webm;codecs=opus')
  })

  it('pickSupportedMimeType() walks past unsupported entries when the preference list leads with an unknown MIME', () => {
    // The picker must skip an entry the browser can't produce rather
    // than return early. Scenario: operator's preferred list leads
    // with a container the running browser doesn't support yet — the
    // picker must walk past it to the next candidate so the recording
    // doesn't fail because of an unsupported lead slot.
    const result = pickSupportedMimeType([
      'audio/x-unknown',
      'audio/webm;codecs=opus',
    ])
    expect(result).toBe('audio/webm;codecs=opus')
    expect(result).not.toBe('audio/x-unknown')
  })

  it('stop() transitions to preview and resolves the recorded blob', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { start, dispose } = mountHarness()
    await start.start()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    // Drive the dataavailable flush before stop. The real lifecycle
    // emits one or more dataavailable events and then onstop.
    recorder.fireDataAvailable(makeBlob())
    const blob = await start.stop()
    expect(start.state.value).toBe('preview')
    expect(blob).not.toBeNull()
    expect(blob?.size).toBeGreaterThan(0)
    dispose()
  })

  it('cancel() returns to idle and clears the blob even mid-recording', async () => {
    const { start, dispose } = mountHarness()
    await start.start()
    start.cancel()
    expect(start.state.value).toBe('idle')
    expect(start.audioBlob.value).toBeNull()
    dispose()
  })

  it('discard() drops a recorded blob without touching the MediaRecorder', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { start, dispose } = mountHarness()
    await start.start()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(makeBlob())
    await start.stop()
    expect(start.state.value).toBe('preview')
    start.discard()
    expect(start.state.value).toBe('idle')
    expect(start.audioBlob.value).toBeNull()
    dispose()
  })

  it('classifies getUserMedia rejection into the NOT_ALLOWED error state', async () => {
    getUserMediaSpy?.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const { start, dispose } = mountHarness()
    await start.start()
    expect(start.state.value).toBe('error')
    expect(start.error.value?.code).toBe('NOT_ALLOWED')
    dispose()
  })

  it('classifies missing-device rejection into the NOT_FOUND error state', async () => {
    getUserMediaSpy?.mockRejectedValueOnce(Object.assign(new Error('none'), { name: 'NotFoundError' }))
    const { start, dispose } = mountHarness()
    await start.start()
    expect(start.state.value).toBe('error')
    expect(start.error.value?.code).toBe('NOT_FOUND')
    dispose()
  })

  it('dispose() stops every media track on the active stream', async () => {
    const { start, dispose } = mountHarness()
    await start.start()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    const track = recorder.stream.getTracks()[0]
    expect(track.readyState).toBe('live')
    dispose()
    expect(track.readyState).toBe('ended')
  })

  it('classifies MediaRecorder construction failure into the UNSUPPORTED error state', async () => {
    // Override the shim constructor so `new MediaRecorder(...)` throws.
    // The composable catches the constructor error and surfaces it as
    // UNSUPPORTED — mirrors the production path when an unsupported
    // MIME makes the recorder refuse to instantiate.
    const originalIsTypeSupported = (globalThis as unknown as { MediaRecorder: typeof MockMediaRecorder }).MediaRecorder.isTypeSupported
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {
      static isTypeSupported(mime: string): boolean {
        return originalIsTypeSupported(mime)
      }
      constructor() {
        throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
      }
      static lastInstance: unknown = null
    }
    try {
      const { start, dispose } = mountHarness()
      await start.start()
      expect(start.state.value).toBe('error')
      expect(start.error.value?.code).toBe('UNSUPPORTED')
      dispose()
    } finally {
      ;(globalThis as unknown as { MediaRecorder: typeof MockMediaRecorder }).MediaRecorder = MockMediaRecorder
    }
  })

  it('cancel() resolves the pending stop promise when called mid-finalize', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { start, dispose } = mountHarness()
    await start.start()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(makeBlob())
    // Start the stop, then cancel before the queued onstop microtask
    // resolves the promise. cancel() must explicitly resolve the
    // pending resolver with null so callers don't hang.
    const stopPromise = start.stop()
    expect(start.state.value).toBe('finalizing')
    start.cancel()
    expect(start.state.value).toBe('idle')
    const blob = await stopPromise
    expect(blob).toBeNull()
    dispose()
    vi.useRealTimers()
  })

  it('start() is a no-op when called again while already recording', async () => {
    const { start, dispose } = mountHarness()
    await start.start()
    const before = MockMediaRecorder.lastInstance
    await start.start()
    expect(MockMediaRecorder.lastInstance).toBe(before)
    dispose()
  })

  it('stop() is a no-op when called outside the recording state', async () => {
    const { start, dispose } = mountHarness()
    expect(start.state.value).toBe('idle')
    const blob = await start.stop()
    expect(blob).toBeNull()
    dispose()
  })
})
