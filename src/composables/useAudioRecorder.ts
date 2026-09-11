/**
 * useAudioRecorder — MediaRecorder wrapper for the composer's voice input.
 *
 * State machine:
 *
 *   idle ──start()──▶ recording ──stop()──▶ finalizing ──▶ preview
 *                          │                    │
 *                          │                    └─▶ error (upload/transcribe failure)
 *                          ├─cancel()─────────▶ idle
 *                          └─dispose()────────▶ (terminal)
 *   preview ──discard()──▶ idle
 *   preview ──confirm()──▶ emits `recorded` ──▶ idle
 *
 * MIME negotiation prefers opus-encoded containers (the only formats the
 * shipped STT providers currently accept losslessly), then falls back to
 * the browser default. The chosen MIME is forwarded to the server on the
 * `/media` upload so the asset row records the actual container — the
 * Meta Muse provider additionally re-encodes to mono PCM WAV via ffmpeg
 * before sending to the upstream API.
 */
import { onScopeDispose, ref, type Ref } from 'vue'

export type AudioRecorderState = 'idle' | 'recording' | 'finalizing' | 'preview' | 'error'

export interface AudioRecorderError {
  code: 'NOT_ALLOWED' | 'NOT_FOUND' | 'OVERCONSTRAINED' | 'UNSUPPORTED' | 'GENERIC'
  message: string
}

export interface UseAudioRecorder {
  state: Ref<AudioRecorderState>
  elapsedMs: Ref<number>
  audioBlob: Ref<Blob | null>
  mimeType: Ref<string | null>
  error: Ref<AudioRecorderError | null>
  /** Begin recording. Resolves once the MediaRecorder is producing data. */
  start(): Promise<void>
  /**
   * Stop recording and resolve the final blob. Transitions to `finalizing`
   * until the `dataavailable` flush arrives, then to `preview`. If the
   * recorder is not active, resolves to the current blob without state
   * change (no-op).
   */
  stop(): Promise<Blob | null>
  /** Abort the current recording and release resources. Resets to `idle`. */
  cancel(): void
  /** Drop the recorded blob and return to `idle` (called from preview's Discard). */
  discard(): void
  /** Release MediaStream tracks. Safe to call multiple times. */
  dispose(): void
}

/**
 * Probe `MediaRecorder.isTypeSupported` against a fixed preference list.
 * The list mirrors the order documented in the plan: opus in webm first
 * (Chrome/Edge default), then opus in ogg (Firefox default), then mp4
 * (Safari). The empty string lets the browser pick its own default as a
 * last resort — useful in embedded WebViews that advertise no specific
 * container.
 */
export function pickSupportedMimeType(): string {
  const mediaRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  if (mediaRecorder === undefined) {
    return ''
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/webm',
    '',
  ]
  for (const candidate of candidates) {
    if (candidate === '' || mediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

/**
 * Translate the DOMException names raised by `getUserMedia` and
 * `MediaRecorder.start` into the {@link AudioRecorderError} shape the UI
 * renders. The strings are deliberately short — the recording button
 * surfaces them verbatim inside a tiny error chip.
 */
function classifyError(err: unknown): AudioRecorderError {
  if (err instanceof Error) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return { code: 'NOT_ALLOWED', message: 'Microphone permission denied.' }
      case 'NotFoundError':
        return { code: 'NOT_FOUND', message: 'No microphone was found on this device.' }
      case 'OverconstrainedError':
        return { code: 'OVERCONSTRAINED', message: 'No microphone matched the recording constraints.' }
      case 'NotSupportedError':
        return { code: 'UNSUPPORTED', message: 'Audio recording is not supported in this browser.' }
    }
    return { code: 'GENERIC', message: err.message || 'Recording failed.' }
  }
  return { code: 'GENERIC', message: 'Recording failed.' }
}

export function useAudioRecorder(): UseAudioRecorder {
  const state = ref<AudioRecorderState>('idle')
  const elapsedMs = ref(0)
  const audioBlob = ref<Blob | null>(null)
  const mimeType = ref<string | null>(null)
  const error = ref<AudioRecorderError | null>(null)

  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let chunks: Blob[] = []
  let tickHandle: ReturnType<typeof setInterval> | null = null
  let startTimestamp = 0
  let stopResolver: ((value: Blob | null) => void) | null = null
  let disposed = false

  function clearTick(): void {
    if (tickHandle !== null) {
      clearInterval(tickHandle)
      tickHandle = null
    }
  }

  function releaseStream(): void {
    if (mediaStream === null) {
      return
    }
    for (const track of mediaStream.getTracks()) {
      track.stop()
    }
    mediaStream = null
  }

  function reset(): void {
    mediaRecorder = null
    chunks = []
    startTimestamp = 0
    stopResolver = null
    clearTick()
    releaseStream()
  }

  async function start(): Promise<void> {
    if (disposed) {
      throw new Error('Recorder has been disposed.')
    }
    if (state.value === 'recording') {
      return
    }
    error.value = null
    audioBlob.value = null

    // Probe at request time so the test-time mock can change its
    // supported-MIME list between start() calls.
    const chosenMime = pickSupportedMimeType()
    mimeType.value = chosenMime === '' ? null : chosenMime

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      error.value = classifyError(err)
      state.value = 'error'
      return
    }

    try {
      mediaRecorder = chosenMime === ''
        ? new MediaRecorder(mediaStream)
        : new MediaRecorder(mediaStream, { mimeType: chosenMime })
    } catch (err) {
      error.value = classifyError(err)
      state.value = 'error'
      releaseStream()
      return
    }

    chunks = []
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType.value ?? 'audio/webm' })
      audioBlob.value = blob
      const resolve = stopResolver
      stopResolver = null
      state.value = 'preview'
      releaseStream()
      if (resolve !== null) {
        resolve(blob)
      }
    }
    mediaRecorder.onerror = (event: Event) => {
      const err = (event as ErrorEvent).error ?? new Error('MediaRecorder error')
      error.value = classifyError(err)
      state.value = 'error'
      clearTick()
      releaseStream()
      const resolve = stopResolver
      stopResolver = null
      if (resolve !== null) {
        resolve(null)
      }
    }

    try {
      mediaRecorder.start()
    } catch (err) {
      error.value = classifyError(err)
      state.value = 'error'
      reset()
      return
    }

    state.value = 'recording'
    startTimestamp = performance.now()
    elapsedMs.value = 0
    tickHandle = setInterval(() => {
      elapsedMs.value = Math.round(performance.now() - startTimestamp)
    }, 100)
  }

  function stop(): Promise<Blob | null> {
    if (state.value !== 'recording' || mediaRecorder === null) {
      return Promise.resolve(audioBlob.value)
    }
    state.value = 'finalizing'
    clearTick()
    return new Promise<Blob | null>((resolve) => {
      stopResolver = resolve
      try {
        mediaRecorder!.stop()
      } catch (err) {
        error.value = classifyError(err)
        state.value = 'error'
        releaseStream()
        const r = stopResolver
        stopResolver = null
        if (r !== null) {
          r(null)
        }
      }
    })
  }

  function cancel(): void {
    if (state.value === 'recording' && mediaRecorder !== null) {
      try {
        mediaRecorder.stop()
      } catch {
        // Already stopped — nothing to do.
      }
    }
    if (state.value === 'finalizing' && stopResolver !== null) {
      stopResolver(null)
      stopResolver = null
    }
    audioBlob.value = null
    error.value = null
    elapsedMs.value = 0
    state.value = 'idle'
    reset()
  }

  function discard(): void {
    audioBlob.value = null
    error.value = null
    elapsedMs.value = 0
    state.value = 'idle'
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    if (state.value === 'recording' && mediaRecorder !== null) {
      try {
        mediaRecorder.stop()
      } catch {
        // Ignore — we're tearing down anyway.
      }
    }
    clearTick()
    releaseStream()
    chunks = []
    mediaRecorder = null
  }

  onScopeDispose(() => {
    dispose()
  })

  return {
    state,
    elapsedMs,
    audioBlob,
    mimeType,
    error,
    start,
    stop,
    cancel,
    discard,
    dispose,
  }
}
