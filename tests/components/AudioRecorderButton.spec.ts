/**
 * AudioRecorderButton — full state-machine + commit-pipeline coverage.
 *
 * Drives the component through idle → recording → finalizing → preview
 * → Use, plus the discard / error / skip-preview-opt-out paths. Mocks
 * `api.postForm` + `postTranscribeAudio` so the upload + transcribe
 * calls happen against in-memory spies (not a real backend).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, type Ref } from 'vue'

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
  ApiError: class ApiError extends Error { code = ''; status = 0 },
  getSpeechCapability: (): Promise<unknown> => apiMock.get('/speech/capability'),
  postTranscribeAudio: (body: unknown): Promise<unknown> => apiMock.post('/speech/transcribe', body),
}))

const speechRefreshMock = vi.fn().mockResolvedValue(undefined)
const speechCanRecord = (() => {
  let v = false
  return {
    get value() { return v },
    set value(next: boolean) { v = next },
  }
})()

vi.mock('@/composables/useSpeechCapability', () => ({
  useSpeechCapability: () => ({
    state: { value: { available: false, configured: false, providers: [] } },
    canRecord: speechCanRecord as unknown as Ref<boolean>,
    loading: { value: false },
    error: { value: null },
    refresh: speechRefreshMock,
  }),
}))

const speechPrefsMock = vi.hoisted(() => {
  const ref = { value: false }
  return {
    ref,
    setSkip: (v: boolean) => { ref.value = v },
  }
})

vi.mock('@/composables/useSpeechPreferences', () => ({
  useSpeechPreferences: () => ({
    skipSpeechPreview: speechPrefsMock.ref as unknown as Ref<boolean>,
    setSkipSpeechPreview: speechPrefsMock.setSkip,
    toggleSkipSpeechPreview: vi.fn(),
  }),
}))

// `useAuthStore` reads `auth.user.is_admin` to decide the "Set up"
// deep-link route in the disabled state. The hook only needs the
// `user` ref — no `init()` / network — so a stub with a settable ref
// covers the production read path.
const authUserRef = ref<{ is_admin: boolean } | null>(null)

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() {
      return authUserRef.value
    },
  }),
}))

const IconStub = {
  name: 'Icon',
  props: ['name'],
  template: '<span class="icon-stub" :data-name="name" />',
}

import AudioRecorderButton from '@/components/AudioRecorderButton.vue'
import type { MediaAsset } from '@/types/media'

const MockMediaRecorder = (globalThis as unknown as { __mediaRecorder: {
  lastInstance: {
    state: 'inactive' | 'recording' | 'stopped'
    options?: MediaRecorderOptions
    stream: { getTracks(): Array<{ stop(): void, readyState: 'live' | 'ended' }> }
    fireDataAvailable(blob: Blob): void
    fireError(message: string): void
  } | null
} }).__mediaRecorder

const getUserMediaSpy = (globalThis as unknown as { __getUserMedia?: ReturnType<typeof vi.fn> }).__getUserMedia

beforeEach(() => {
  setActivePinia(createPinia())
  apiMock.get.mockReset()
  apiMock.post.mockReset()
  apiMock.postForm.mockReset()
  MockMediaRecorder.lastInstance = null
  getUserMediaSpy?.mockClear()
  speechCanRecord.value = true
  speechRefreshMock.mockClear()
  // Default `skipSpeechPreview` flipped from false to true — new
  // operators skip the preview step. Existing ones who set it false
  // in localStorage keep that. Each preview-path test below calls
  // `speechPrefsMock.setSkip(false)` to land in the preview branch.
  speechPrefsMock.setSkip(true)
  authUserRef.value = null
  localStorage.clear()
})

function factory(overrides: Record<string, unknown> = {}): ReturnType<typeof mount> {
  // Stub `RouterLink` so the disabled-state "Set up" link resolves
  // without a real router instance. The stub serialises both string
  // and object-form `to` props into an `href` the test can assert on.
  // Object `to` props need a name → path lookup because the test
  // mounts without a router; the map mirrors the production routes
  // the AudioRecorderButton deep-links to so assertions can match the
  // href a real router would render.
  const ROUTE_PATHS: Record<string, string> = {
    'settings-speech': '/settings/speech',
    'settings-admin-speech-providers': '/settings/admin/speech-providers',
  }
  const RouterLinkStub = {
    name: 'RouterLink',
    props: ['to'],
    computed: {
      href(): string {
        if (typeof this.to === 'string') {
          return this.to
        }
        if (this.to === null || typeof this.to !== 'object') {
          return ''
        }
        const obj = this.to as { path?: string, name?: string, query?: Record<string, string> }
        const base = obj.path ?? (typeof obj.name === 'string' ? (ROUTE_PATHS[obj.name] ?? `/${obj.name}`) : '')
        const params = obj.query ?? {}
        const entries = Object.entries(params)
        if (entries.length === 0) {
          return base
        }
        return `${base}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`
      },
    },
    template: '<a :href="href"><slot /></a>',
  }
  return mount(AudioRecorderButton, {
    props: { agentId: 7, ...overrides },
    global: { stubs: { Icon: IconStub, RouterLink: RouterLinkStub } },
  })
}

describe('AudioRecorderButton', () => {
  it('renders the default pill-shaped Record button with a "Record" text label', () => {
    const wrapper = factory()
    const btn = wrapper.find('[data-testid="audio-record-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Record')
    expect(btn.attributes('title')).toBe('Record audio')
  })

it('renders an icon-only compact button when the `compact` prop is set', () => {
      const wrapper = factory({ compact: true })
      const btn = wrapper.find('[data-testid="audio-record-button"]')
      expect(btn.exists()).toBe(true)
      expect(btn.text().trim()).toBe('')
      expect(btn.attributes('title')).toBe('Record audio')
      expect(btn.attributes('aria-label')).toBe('Record audio')
    })

    it('renders an icon-only compact disabled indicator when `compact` is set and canRecord is false', () => {
      speechCanRecord.value = false
      const wrapper = factory({ compact: true })
      const disabled = wrapper.find('[data-testid="audio-disabled-state"]')
      expect(disabled.exists()).toBe(true)
      expect(disabled.text().trim()).toBe('')
      expect(wrapper.find('[data-testid="audio-setup-link"]').exists()).toBe(false)
      expect(disabled.attributes('aria-label')).toBe('Voice input is not configured for this operator')
      expect(disabled.attributes('title')).toBe('Voice not configured')
      const icon = wrapper.find('[data-testid="audio-disabled-state"] .icon-stub')
      expect(icon.exists()).toBe(true)
      expect(icon.attributes('data-name')).toBe('mic-off')
    })

  it('probes /speech/capability on mount', () => {
    factory()
    expect(speechRefreshMock).toHaveBeenCalledTimes(1)
  })

  it('clicking Record transitions to recording and shows the timer + Ready button', async () => {
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    expect(MockMediaRecorder.lastInstance).not.toBeNull()
    expect(wrapper.find('[data-testid="audio-recorder-timer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-stop-button"]').exists()).toBe(true)
  })

  it('clicking the Ready button transitions through finalizing into preview with the audio element', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Force the preview branch — the flipped default would otherwise
    // auto-commit on Stop.
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)], { type: 'audio/webm' }))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-and-send-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-discard-button"]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('surfaces both Transcribe & send and Transcribe in the preview (no prop-gated hiding)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    speechPrefsMock.setSkip(false)
    // The submitOnSend prop was removed when both CTAs moved onto every
    // composer. The preview renders both buttons regardless of caller
    // — the parent decides what `mode` to honour on the emitted event.
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)], { type: 'audio/webm' }))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-and-send-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-transcribe-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-discard-button"]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('Transcribe uploads and emits recorded with mode: "use"', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    const blob = new Blob(['x'.repeat(16)], { type: 'audio/webm' })
    recorder.fireDataAvailable(blob)
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    const SAMPLE: MediaAsset = {
      id: 'asset-1',
      filename: 'recording.webm',
      media_type: 'audio',
      mime_type: 'audio/webm',
      byte_size: 16,
      asset_url: 'https://example.test/recording.webm',
      has_markdown: false,
    }
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    apiMock.post.mockResolvedValueOnce({
      text: 'transcribed hello',
      language: 'en',
      duration_ms: 1024,
    })

    const transcribeBtn = wrapper.find('[data-testid="audio-transcribe-button"]')
    expect(transcribeBtn.exists()).toBe(true)
    expect(transcribeBtn.text()).toContain('Transcribe')
    await transcribeBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]
    expect(path).toBe('/media')
    expect(form).toBeInstanceOf(FormData)
    // New: the upload form carries `is_temporary=true` so the
    // backend's per-(user, agent) retention pipeline can GC the row
    // if the operator never promotes it via `/media/{id}/keep`.
    expect(form.get('is_temporary')).toBe('true')
    expect(form.get('agent_id')).toBe('7')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })

    const recorded = wrapper.emitted('recorded')
    expect(recorded).toBeDefined()
    expect(recorded![0]).toEqual([
      { media: SAMPLE, transcript: 'transcribed hello', mode: 'use' },
    ])
    // After commit, returns to idle (button re-renders).
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('Transcribe does NOT emit `recorded` when the transcript comes back empty (no audio leak to LLM)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
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

    const SAMPLE: MediaAsset = {
      id: 'asset-empty',
      filename: 'recording.webm',
      media_type: 'audio/webm',
      byte_size: 16,
      asset_url: 'https://example.test/recording.webm',
      has_markdown: false,
    }
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    // Transcribe returns whitespace-only text — same shape the backend
    // uses for an audio file that the model couldn't transcribe.
    apiMock.post.mockResolvedValueOnce({
      text: '   ',
      language: null,
      duration_ms: 0,
    })

    await wrapper.find('[data-testid="audio-transcribe-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    // Upload still happens — the row lives as `is_temporary=true`
    // and the backend's retention pipeline GCs it.
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })

    // But `recorded` is NOT emitted, so the parent never attaches the
    // audio file to the outgoing message. The LLM won't see it.
    expect(wrapper.emitted('recorded')).toBeUndefined()
    vi.useRealTimers()
  })

  it('Send uploads and emits recorded with mode: "send"', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
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

    const SAMPLE: MediaAsset = {
      id: 'asset-send',
      filename: 'recording.webm',
      media_type: 'audio',
      mime_type: 'audio/webm',
      byte_size: 16,
      asset_url: 'https://example.test/recording.webm',
      has_markdown: false,
    }
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    apiMock.post.mockResolvedValueOnce({
      text: 'send transcript',
      language: 'en',
      duration_ms: 1024,
    })

    const sendBtn = wrapper.find('[data-testid="audio-transcribe-and-send-button"]')
    expect(sendBtn.exists()).toBe(true)
    expect(sendBtn.text()).toContain('Transcribe & send')
    await sendBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    // Send and Transcribe share the same pipeline; only the
    // discriminator on the emit differs.
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })
    const recorded = wrapper.emitted('recorded')
    expect(recorded).toBeDefined()
    expect(recorded![0]).toEqual([
      { media: SAMPLE, transcript: 'send transcript', mode: 'send' },
    ])
    vi.useRealTimers()
  })

  it('Send button shows "Transcribing…" with a spinner while uploading', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)]))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    // Hang the upload so the button stays in `submitting` long enough
    // to assert the label change.
    apiMock.postForm.mockReturnValueOnce(new Promise(() => {}))
    const sendBtn = wrapper.find('[data-testid="audio-transcribe-and-send-button"]')
    await sendBtn.trigger('click')
    await flushPromises()
    expect(sendBtn.text()).toContain('Transcribing')
    expect(sendBtn.attributes('disabled')).toBeDefined()
    vi.useRealTimers()
  })

  it('clicking Discard drops the blob and returns to idle without emitting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Opt into the preview path — the default flip would auto-commit
    // on Stop before this test even reaches the Discard click.
    speechPrefsMock.setSkip(false)
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)]))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="audio-discard-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)
    expect(apiMock.postForm).not.toHaveBeenCalled()
    expect(wrapper.emitted('recorded')).toBeUndefined()
    vi.useRealTimers()
  })

  it('renders the error chip and Try-again button when getUserMedia rejects', async () => {
    getUserMediaSpy?.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="audio-error-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-retry-button"]').exists()).toBe(true)
  })

  it('Try-again returns the recorder to idle', async () => {
    getUserMediaSpy?.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="audio-retry-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)
  })

  it('skips preview when skipSpeechPreview is enabled', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Pre-arm the prefs composable mock so it returns true on init.
    // This is the new default — new operators skip the preview step
    // and get an immediate auto-transcribe.
    speechPrefsMock.setSkip(true)

    const SAMPLE: MediaAsset = {
      id: 'asset-skip',
      filename: 'recording.webm',
      media_type: 'audio',
      mime_type: 'audio/webm',
      byte_size: 16,
      asset_url: 'https://example.test/recording.webm',
      has_markdown: false,
    }
    apiMock.postForm.mockResolvedValueOnce(SAMPLE)
    apiMock.post.mockResolvedValueOnce({ text: 'auto transcript', language: 'en', duration_ms: 512 })

    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)]))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()
    // No preview step — the commit ran inline after finalizing.
    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(false)
    const recorded = wrapper.emitted('recorded')
    expect(recorded).toBeDefined()
    // Auto-transcribe uses mode 'use' — the parent stages the asset +
    // transcript and lets the user click Send themselves (matches the
    // Transcribe button path so the same code path handles both
    // single-click flows).
    expect(recorded![0]).toEqual([
      { media: SAMPLE, transcript: 'auto transcript', mode: 'use' },
    ])

    vi.useRealTimers()
  })

  it('shows the preview path by default once the user opts back in (setSkip(false))', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // The flipped default is true (auto-transcribe); a user who
    // explicitly toggled the flag off in settings should land in the
    // preview branch — assert that path stays intact.
    speechPrefsMock.setSkip(false)

    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    const recorder = MockMediaRecorder.lastInstance
    if (recorder === null) {
      throw new Error('MediaRecorder shim was not invoked')
    }
    recorder.fireDataAvailable(new Blob(['x'.repeat(16)]))
    await wrapper.find('[data-testid="audio-stop-button"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="audio-preview"]').exists()).toBe(true)
    expect(wrapper.emitted('recorded')).toBeUndefined()
    expect(apiMock.postForm).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  describe('disabled state (no STT config)', () => {
    it('hides the Record button and shows the "Voice not configured" pill when canRecord is false', () => {
      speechCanRecord.value = false
      const wrapper = factory()
      expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="audio-disabled-state"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Voice not configured')
    })

    it('renders the muted mic-off icon in the disabled state', () => {
      speechCanRecord.value = false
      const wrapper = factory()
      const icon = wrapper.find('[data-testid="audio-disabled-state"] .icon-stub')
      expect(icon.exists()).toBe(true)
      expect(icon.attributes('data-name')).toBe('mic-off')
    })

    it('routes the "Set up" link to the user speech settings for non-admin users', () => {
      speechCanRecord.value = false
      authUserRef.value = { is_admin: false }
      const wrapper = factory()
      const link = wrapper.find('[data-testid="audio-setup-link"]')
      expect(link.exists()).toBe(true)
      // The link is a route object — name `settings-speech` plus
      // `?create=1` so `SpeechProviderConfigsPage` opens the create
      // form. The stub serialises it to `/settings/speech?create=1`
      // for the assertion.
      expect(link.attributes('href')).toBe('/settings/speech?create=1')
    })

    it('routes the "Set up" link to the admin speech providers page for global admins', () => {
      speechCanRecord.value = false
      authUserRef.value = { is_admin: true }
      const wrapper = factory()
      const link = wrapper.find('[data-testid="audio-setup-link"]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/settings/admin/speech-providers?create=1')
    })

    it('falls back to the user route when no user is logged in', () => {
      speechCanRecord.value = false
      authUserRef.value = null
      const wrapper = factory()
      const link = wrapper.find('[data-testid="audio-setup-link"]')
      expect(link.attributes('href')).toBe('/settings/speech?create=1')
    })

    it('does not probe /speech/capability when the record button is the disabled state', () => {
      // The capability probe still fires on mount — it's the lazy
      // `refresh()` that backs `canRecord`. The test guards against
      // accidental future regressions where the disabled state skips
      // the probe entirely (which would prevent the button from
      // upgrading to enabled once the operator finishes setup).
      speechCanRecord.value = false
      factory()
      expect(speechRefreshMock).toHaveBeenCalledTimes(1)
    })
  })
})
