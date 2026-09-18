/**
 * recordFlow — end-to-end integration coverage for the recording flow.
 *
 * Mounts a parent wrapper (mirrors `ComposerInput.onAudioRecorded`'s
 * prepend-transcript shape) on top of `AudioRecorderButton`, mocks
 * `MediaRecorder` + `/media` + `/speech/transcribe`, and drives the
 * full state machine end-to-end:
 *
 *   record → preview → Transcribe → upload (FormData) → transcribe →
 *   `recorded` emit (mode: 'use') → textarea receives transcript
 *
 * Plus the disabled-state path (no STT config → pill renders, Record
 * button hidden) and the 4xx error path (transcribe fails → toast
 * surfaces the error, preview still intact so the operator can
 * retry). Memory-history vue-router is wired so future navigation
 * assertions can be added without a real server.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref, h, type Ref } from 'vue'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import AudioRecorderButton from '@/components/AudioRecorderButton.vue'
import { ApiError } from '@/api/client'
import type { MediaAsset } from '@/types/media'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  postForm: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    code = ''
    status = 0
    constructor(message: string, code: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.code = code
      this.status = status
    }
  },
  getSpeechCapability: (): Promise<unknown> => apiMock.get('/speech/capability'),
  postTranscribeAudio: (body: unknown): Promise<unknown> => apiMock.post('/speech/transcribe', body),
}))

// `useSpeechCapability` is the gating composable: `canRecord`
// switches between the recording UI and the disabled-state pill. The
// refresh is a no-op spy — the production network path is exercised
// in `useSpeechCapability.spec.ts`, not here.
const speechCanRecord = ref(true)
const speechRefreshMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/composables/useSpeechCapability', () => ({
  useSpeechCapability: () => ({
    state: { value: { available: true, configured: true, providers: [] } },
    canRecord: speechCanRecord as unknown as Ref<boolean>,
    effectiveClass: { value: null } as unknown as Ref<string | null>,
    effectiveSource: { value: null } as unknown as Ref<unknown>,
    loading: { value: false },
    error: { value: null },
    refresh: speechRefreshMock,
  }),
}))

// `useSpeechPreferences` is the localStorage-backed `skipSpeechPreview`
// toggle. Hard-coded to `false` so the test stays on the preview
// branch — the integration scope is the multi-step commit flow, not
// the auto-transcribe opt-in path.
vi.mock('@/composables/useSpeechPreferences', () => ({
  useSpeechPreferences: () => ({
    skipSpeechPreview: ref(false) as unknown as Ref<boolean>,
    setSkipSpeechPreview: vi.fn(),
    toggleSkipSpeechPreview: vi.fn(),
  }),
}))

// `useAuthStore` only feeds the disabled-state route derivation.
// Tests flip `authUserRef.value` to cover admin vs non-admin.
const authUserRef = ref<{ is_admin: boolean } | null>(null)

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() {
      return authUserRef.value
    },
  }),
}))

// `useToast` exposes the toast surface the recording flow calls when
// the transcribe endpoint rejects. Mocking the manager lets the error
// path assert on `toast.error(...)` without rendering the toast
// container.
const toastMock = vi.hoisted(() => ({
  toasts: [] as Array<{ id: string; severity: string; message: string }>,
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

const MockMediaRecorder = (globalThis as unknown as { __mediaRecorder: {
  lastInstance: {
    state: 'inactive' | 'recording' | 'stopped'
    stream: { getTracks(): Array<{ stop(): void, readyState: 'live' | 'ended' }> }
    fireDataAvailable(blob: Blob): void
  } | null
} }).__mediaRecorder

/**
 * Mirrors `ComposerInput.onAudioRecorded`: prepends the transcript text
 * to the prompt area. The audio asset on the payload is intentionally
 * NOT forwarded — forwarding it makes the LLM hedge with "couldn't
 * extract any text from the attached file" when the transcript is
 * short. The `chips` count stays at 0 for the audio path; only `mode:
 * 'send'` would auto-submit (out of scope here — the integration test
 * focuses on the staged-transcript path).
 */
const ParentWrapper = defineComponent({
  name: 'ParentWrapper',
  props: { agentId: { type: Number, required: true } },
  setup(props) {
    const prompt = ref('')
    const chips = ref<MediaAsset[]>([])

    function onRecorded(payload: { media: MediaAsset, transcript: string, mode: 'use' | 'send' }): void {
      const transcript = payload.transcript.trim()
      if (transcript.length === 0) {
        return
      }
      const existing = prompt.value.trim()
      prompt.value = existing.length === 0
        ? transcript
        : `${transcript}\n\n${existing}`
      // The audio asset is ignored — the row stays server-side and the
      // retention pipeline sweeps it. `chips` is exposed for the test
      // to assert the parent did NOT add a chip.
      void payload.media
      void payload.mode
    }

    return () => h('div', { 'data-testid': 'parent-wrapper' }, [
      h('textarea', {
        'data-testid': 'parent-prompt',
        value: prompt.value,
        readonly: true,
      }),
      h('div', { 'data-testid': 'parent-chips', 'data-count': String(chips.value.length) }),
      h(AudioRecorderButton, {
        agentId: props.agentId,
        onRecorded,
      }),
    ])
  },
})

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      // Landing route so the memory-history's initial `/` resolves
      // before the disabled-state test pushes the deep-link target.
      { path: '/', name: 'integration-home', component: { template: '<div />' } },
      // Both admin and user "Set up" deep-link targets. The
      // production component emits a route object
      // ({ name, query: { create: '1' } }), not a hard-coded `/new`
      // path, so the placeholder routes here mirror the real
      // `settings-speech` / `settings-admin-speech-providers` route
      // names from `src/router/index.ts`. The query assertion on
      // `router.currentRoute.value.query` is the test signal — the
      // placeholder components exist only so vue-router has a
      // matching named route to navigate to.
      { path: '/settings/speech', name: 'settings-speech', component: { template: '<div />' } },
      { path: '/settings/admin/speech-providers', name: 'settings-admin-speech-providers', component: { template: '<div />' } },
    ],
  })
}

const SAMPLE: MediaAsset = {
  id: 'asset-rec',
  filename: 'recording.webm',
  media_type: 'audio',
  mime_type: 'audio/webm',
  byte_size: 16,
  asset_url: 'https://example.test/recording.webm',
  has_markdown: false,
}

const SUCCESS_TRANSCRIPTION = {
  text: 'hello world',
  language: 'en',
  duration_ms: 1024,
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiMock.get.mockReset()
  apiMock.post.mockReset()
  apiMock.postForm.mockReset()
  MockMediaRecorder.lastInstance = null
  speechCanRecord.value = true
  speechRefreshMock.mockClear()
  authUserRef.value = null
  toastMock.success.mockReset()
  toastMock.warning.mockReset()
  toastMock.error.mockReset()
  toastMock.info.mockReset()
  localStorage.clear()
})

function mountParent(router: Router) {
  return mount(ParentWrapper, {
    props: { agentId: 7 },
    global: {
      plugins: [router],
      stubs: {
        // Skip `Icon` so we don't have to mirror every icon name in
        // both the happy and disabled branches. The disabled-state
        // assertion targets the `audio-disabled-state` wrapper, not
        // the icon glyph.
        Icon: { name: 'Icon', props: ['name'], template: '<span class="icon-stub" :data-name="name" />' },
      },
    },
  })
}

describe('recordFlow', () => {
  it('record → preview → Transcribe → upload (FormData) → transcribe → emit → textarea receives transcript', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const router = makeRouter()
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    apiMock.post.mockResolvedValueOnce(SUCCESS_TRANSCRIPTION)

    const wrapper = mountParent(router)
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)

    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)], { type: 'audio/webm' }))

    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-and-send-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-discard-button"]').exists()).toBe(true)

    await wrapper.find('[data-testid="audio-transcribe-button"]').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    // /media POST must carry the audio blob as a FormData file part
    // + the agent id alongside it + the is_temporary flag so the
    // per-(user, agent) retention pipeline can GC the row.
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]!
    expect(path).toBe('/media')
    expect(form).toBeInstanceOf(FormData)
    const file = (form as FormData).get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((form as FormData).get('agent_id')).toBe('7')
    expect((form as FormData).get('is_temporary')).toBe('true')

    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })

    // Downstream: parent received only the transcript text — the audio
    // MediaAsset on the payload is intentionally ignored so the LLM
    // never sees the recording.webm as an attachment.
    expect(wrapper.find('[data-testid="parent-chips"]').attributes('data-count')).toBe('0')
    const textarea = wrapper.find('[data-testid="parent-prompt"]').element as HTMLTextAreaElement
    expect(textarea.value).toBe('hello world')

    vi.useRealTimers()
  })

  it('renders the disabled "Voice not configured" pill when no STT config is available', async () => {
    speechCanRecord.value = false
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mountParent(router)
    expect(wrapper.find('[data-testid="audio-disabled-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Voice not configured')
  })

  it('surfaces an error chip and keeps the preview intact when /speech/transcribe returns 4xx', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const router = makeRouter()
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    apiMock.post.mockRejectedValueOnce(
      new ApiError('Provider rejected the audio: bad request.', 'BAD_REQUEST', 422),
    )

    const wrapper = mountParent(router)

    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)], { type: 'audio/webm' }))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    await wrapper.find('[data-testid="audio-transcribe-button"]').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    // The Transcribe click transitioned to submitting, then the
    // transcribe failure surfaced as a destructive toast error (the
    // inline `audio-submit-error` chip only renders in `idle`, so
    // without the toast the operator would see no feedback in
    // `preview`). The preview is still rendered so the operator can
    // re-Transcribe or discard; no `recorded` event was emitted.
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Provider rejected the audio'))
    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="parent-chips"]').attributes('data-count')).toBe('0')

    vi.useRealTimers()
  })
})