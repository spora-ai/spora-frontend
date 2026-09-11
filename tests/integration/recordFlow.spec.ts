/**
 * recordFlow — end-to-end integration coverage for the recording flow.
 *
 * Mounts a parent wrapper (mirrors `ComposerInput.onAudioRecorded`'s
 * prepend-transcript shape) on top of `AudioRecorderButton`, mocks
 * `MediaRecorder` + `/media` + `/speech/transcribe`, and drives the
 * full state machine end-to-end:
 *
 *   record → preview → Use → upload (FormData) → transcribe →
 *   `recorded` emit → textarea receives transcript
 *
 * Plus the disabled-state deep-link path (no STT config → "Set up"
 * router-link navigates to the user or admin config page) and the
 * 4xx error path (transcribe fails → toast surfaces the error,
 * preview still intact so the operator can retry).
 *
 * Memory-history vue-router so the disabled-state navigation can be
 * asserted end-to-end without a real server.
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
    loading: { value: false },
    error: { value: null },
    refresh: speechRefreshMock,
  }),
}))

// `useSpeechPreferences` is the localStorage-backed `skipSpeechPreview`
// toggle. Defaults to false so the preview path renders.
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
 * Mirrors `ComposerInput.onAudioRecorded`: prepends the transcript to
 * the prompt area with the same `🎤 [transcript]: …` marker the
 * production composer uses, and appends the audio asset to the chip
 * list. Renders the textarea + chip list so the integration test can
 * assert on the downstream state.
 */
const ParentWrapper = defineComponent({
  name: 'ParentWrapper',
  props: { agentId: { type: Number, required: true } },
  setup(props) {
    const prompt = ref('')
    const chips = ref<MediaAsset[]>([])

    function onRecorded(payload: { media: MediaAsset, transcript: string }): void {
      chips.value = [...chips.value, payload.media]
      const existing = prompt.value.trim()
      const transcript = payload.transcript.trim()
      if (transcript.length === 0) {
        return
      }
      prompt.value = existing.length === 0
        ? `🎤 [transcript]: ${transcript}`
        : `🎤 [transcript]: ${transcript}\n\n${existing}`
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
      // Both admin and user "Set up" deep-link targets. PR #145 owns
      // these routes; for the integration test they're placeholder
      // components. The path assertion on `router.currentRoute.value.path`
      // (and `router.push` having been called with the right target)
      // is the test signal — the placeholder components exist only so
      // vue-router has a matching route to navigate to.
      { path: '/settings/speech/new', name: 'settings-speech-new', component: { template: '<div />' } },
      { path: '/settings/admin/speech-providers/new', name: 'settings-admin-speech-new', component: { template: '<div />' } },
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
  it('record → preview → Use → upload (FormData) → transcribe → emit → textarea receives transcript', async () => {
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
    expect(wrapper.find('[data-testid="audio-use-button"]').exists()).toBe(true)

    await wrapper.find('[data-testid="audio-use-button"]').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    // /media POST must carry the audio blob as a FormData file part
    // + the agent id alongside it.
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]!
    expect(path).toBe('/media')
    expect(form).toBeInstanceOf(FormData)
    const file = (form as FormData).get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((form as FormData).get('agent_id')).toBe('7')

    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })

    // Downstream: parent received the chip and the 🎤-prefixed
    // transcript.
    expect(wrapper.find('[data-testid="parent-chips"]').attributes('data-count')).toBe('1')
    const textarea = wrapper.find('[data-testid="parent-prompt"]').element as HTMLTextAreaElement
    expect(textarea.value).toBe('🎤 [transcript]: hello world')

    vi.useRealTimers()
  })

  it('renders the disabled "Set up" deep-link and routes non-admin users to the user settings page', async () => {
    speechCanRecord.value = false
    authUserRef.value = { is_admin: false }
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mountParent(router)
    expect(wrapper.find('[data-testid="audio-disabled-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Voice not configured')

    const link = wrapper.find('[data-testid="audio-setup-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/settings/speech/new')

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings/speech/new')
  })

  it('routes admin users to the admin speech-providers page from the "Set up" link', async () => {
    speechCanRecord.value = false
    authUserRef.value = { is_admin: true }
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mountParent(router)
    const link = wrapper.find('[data-testid="audio-setup-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/settings/admin/speech-providers/new')

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings/admin/speech-providers/new')
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
    await wrapper.find('[data-testid="audio-use-button"]').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    // The Use click transitioned to submitting, then the transcribe
    // failure surfaced as a destructive toast error (the inline
    // `audio-submit-error` chip only renders in `idle`, so without
    // the toast the operator would see no feedback in `preview`).
    // The preview is still rendered so the operator can re-Use or
    // discard; no `recorded` event was emitted.
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Provider rejected the audio'))
    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="parent-chips"]').attributes('data-count')).toBe('0')

    vi.useRealTimers()
  })
})