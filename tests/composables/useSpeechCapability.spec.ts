/**
 * useSpeechCapability — global speech-to-text capability gate.
 *
 * The composable lazily fetches `GET /api/v1/speech/capability` on the
 * first `refresh()` call and stores the result in `state`. The
 * `canRecord` derivation gates the recording button's conditional
 * render.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error { code = ''; status = 0 },
  // Re-route the typed wrappers onto the mocked api so the production
  // path literals stay in the assertions — `expect(apiMock.get).toHaveBeenCalledWith('/speech/capability')`
  // anchors the URL in source rather than in the test factory. The
  // `agentId` arg is threaded straight through so the
  // `refresh(99)` → `get('/speech/capability', { agent_id: 99 })`
  // assertion still works after the per-agent resolution refactor.
  getSpeechCapability: (agentId?: number | null): Promise<unknown> =>
    apiMock.get('/speech/capability', agentId ? { agent_id: agentId } : undefined),
  postTranscribeAudio: (body: unknown): Promise<unknown> => apiMock.post('/speech/transcribe', body),
}))

import { useSpeechCapability } from '@/composables/useSpeechCapability'

function capabilityResponse(data: { available: boolean, configured: boolean, providers: unknown[] }): typeof data {
  return data
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.post.mockReset()
})

describe('useSpeechCapability', () => {
  it('starts with an empty state and `canRecord` false', () => {
    const speech = useSpeechCapability()
    expect(speech.state.value).toEqual({ available: false, configured: false, providers: [] })
    expect(speech.canRecord.value).toBe(false)
  })

  it('refresh() hits GET /speech/capability and sets state', async () => {
    apiMock.get.mockResolvedValueOnce(capabilityResponse({
      available: true,
      configured: true,
      providers: [{ name: 'mistral', display_name: 'Mistral', configured: true }],
    }))
    const speech = useSpeechCapability()
    await speech.refresh()
    expect(apiMock.get).toHaveBeenCalledWith('/speech/capability', undefined)
    expect(speech.state.value.configured).toBe(true)
    expect(speech.canRecord.value).toBe(true)
  })

  it('treats a missing (undefined) response as empty without throwing', async () => {
    apiMock.get.mockResolvedValueOnce(undefined)
    const speech = useSpeechCapability()
    await speech.refresh()
    expect(speech.state.value).toEqual({ available: false, configured: false, providers: [] })
    expect(speech.canRecord.value).toBe(false)
  })

  it('canRecord is false when available is true but configured is false', async () => {
    apiMock.get.mockResolvedValueOnce(capabilityResponse({
      available: true,
      configured: false,
      providers: [{ name: 'mistral', display_name: 'Mistral', configured: false }],
    }))
    const speech = useSpeechCapability()
    await speech.refresh()
    expect(speech.canRecord.value).toBe(false)
  })

  it('canRecord is false when configured is true but available is false', async () => {
    apiMock.get.mockResolvedValueOnce(capabilityResponse({
      available: false,
      configured: true,
      providers: [],
    }))
    const speech = useSpeechCapability()
    await speech.refresh()
    expect(speech.canRecord.value).toBe(false)
  })

  it('falls back to an empty state on API failure so the button hides', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('network'))
    const speech = useSpeechCapability()
    await speech.refresh()
    expect(speech.state.value).toEqual({ available: false, configured: false, providers: [] })
    expect(speech.canRecord.value).toBe(false)
    expect(speech.error.value).toBeNull()
  })

  it('refresh(agentId) forwards the agent id as ?agent_id=N so the badge resolves the cascade against that agent', async () => {
    apiMock.get.mockResolvedValueOnce(capabilityResponse({
      available: true,
      configured: true,
      providers: [
        {
          name: 'mistral',
          display_name: 'Mistral',
          configured: true,
          effective_class: 'X',
          effective_source: 'group_preference',
          effective_config_id: 99,
        },
      ],
    }))
    const speech = useSpeechCapability()
    await speech.refresh(8)
    expect(apiMock.get).toHaveBeenCalledWith('/speech/capability', { agent_id: 8 })
    expect(speech.effectiveSource.value).toBe('group_preference')
  })

  it('refresh(null) omits the agent_id param so the legacy caller-scoped path is preserved for the composer', async () => {
    apiMock.get.mockResolvedValueOnce(capabilityResponse({
      available: true,
      configured: true,
      providers: [
        {
          name: 'mistral',
          display_name: 'Mistral',
          configured: true,
          effective_class: 'X',
          effective_source: 'user_preference',
          effective_config_id: 1,
        },
      ],
    }))
    const speech = useSpeechCapability()
    await speech.refresh(null)
    expect(apiMock.get).toHaveBeenCalledWith('/speech/capability', undefined)
    expect(speech.effectiveSource.value).toBe('user_preference')
  })
})
