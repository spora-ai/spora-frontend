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
  speechPrefsMock.setSkip(false)
  authUserRef.value = null
  localStorage.clear()
})

function factory(): ReturnType<typeof mount> {
  // Stub `RouterLink` so the disabled-state "Set up" link resolves
  // without a real router instance. The stub forwards the `to` prop
  // onto the rendered anchor's `href` so assertions can target the
  // resolved route string directly.
  const RouterLinkStub = {
    name: 'RouterLink',
    props: ['to'],
    template: '<a :href="typeof to === \'string\' ? to : \'\'"><slot /></a>',
  }
  return mount(AudioRecorderButton, {
    props: { agentId: 7 },
    global: { stubs: { Icon: IconStub, RouterLink: RouterLinkStub } },
  })
}

describe('AudioRecorderButton', () => {
  it('mounts the idle state and renders the Record button', () => {
    const wrapper = factory()
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-record-button"]').text()).toContain('Record')
  })

  it('probes /speech/capability on mount', () => {
    factory()
    expect(speechRefreshMock).toHaveBeenCalledTimes(1)
  })

  it('clicking Record transitions to recording and shows the timer + Stop button', async () => {
    const wrapper = factory()
    await wrapper.find('[data-testid="audio-record-button"]').trigger('click')
    await flushPromises()
    expect(MockMediaRecorder.lastInstance).not.toBeNull()
    expect(wrapper.find('[data-testid="audio-recorder-timer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-stop-button"]').exists()).toBe(true)
  })

  it('clicking Stop transitions through finalizing into preview with the audio element', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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
    expect(wrapper.find('[data-testid="audio-use-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audio-discard-button"]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('clicking Use uploads the recording and emits `recorded` with the transcript', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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
    // After the mock's onstop microtask runs the component transitions
    // into preview; flush one more tick so Vue's render queue reflects
    // the new branch before the test searches for the Use button.
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

    const useBtn = wrapper.find('[data-testid="audio-use-button"]')
    expect(useBtn.exists()).toBe(true)
    await useBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]
    expect(path).toBe('/media')
    expect(form).toBeInstanceOf(FormData)
    expect(apiMock.post).toHaveBeenCalledWith('/speech/transcribe', { media_id: SAMPLE.id })

    const recorded = wrapper.emitted('recorded')
    expect(recorded).toBeDefined()
    expect(recorded![0]).toEqual([
      { media: SAMPLE, transcript: 'transcribed hello' },
    ])
    // After commit, returns to idle (button re-renders).
    expect(wrapper.find('[data-testid="audio-record-button"]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('clicking Discard drops the blob and returns to idle without emitting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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
    expect(recorded![0]).toEqual([
      { media: SAMPLE, transcript: 'auto transcript' },
    ])

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
      expect(link.attributes('href')).toBe('/settings/speech/new')
    })

    it('routes the "Set up" link to the admin speech providers page for global admins', () => {
      speechCanRecord.value = false
      authUserRef.value = { is_admin: true }
      const wrapper = factory()
      const link = wrapper.find('[data-testid="audio-setup-link"]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/settings/admin/speech-providers/new')
    })

    it('falls back to the user route when no user is logged in', () => {
      speechCanRecord.value = false
      authUserRef.value = null
      const wrapper = factory()
      const link = wrapper.find('[data-testid="audio-setup-link"]')
      expect(link.attributes('href')).toBe('/settings/speech/new')
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
