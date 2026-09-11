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
import { defineComponent, h, onScopeDispose } from 'vue'
import { mount } from '@vue/test-utils'
import { useAudioRecorder, pickSupportedMimeType } from '@/composables/useAudioRecorder'

interface Captured {
  start: ReturnType<typeof useAudioRecorder>
  dispose: () => void
}

function mountHarness(): Captured {
  let captured: ReturnType<typeof useAudioRecorder> | null = null
  let disposeFn: (() => void) | null = null

  const Harness = defineComponent({
    setup() {
      captured = useAudioRecorder()
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

  it('pickSupportedMimeType() prefers opus-encoded containers', () => {
    expect(pickSupportedMimeType()).toBe('audio/webm;codecs=opus')
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
})
