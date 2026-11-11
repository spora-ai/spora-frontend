/**
 * useComposerSubmit — submit flow for ComposerInput.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const toastMock = { error: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

const createTaskMock = vi.fn()
const clearDraftMock = vi.fn()

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({ createTaskForAgent: createTaskMock }),
}))

const currentAgentRef = ref<unknown>(null)
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get currentAgent() { return currentAgentRef.value },
    clearComposerDraft: clearDraftMock,
  }),
}))

vi.mock('@/api/client', () => ({
  ApiError: class FakeApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { useComposerSubmit } from '@/composables/useComposerSubmit'

beforeEach(() => {
  setActivePinia(createPinia())
  pushMock.mockReset()
  createTaskMock.mockReset()
  createTaskMock.mockResolvedValue({ id: 99 })
  clearDraftMock.mockReset()
  toastMock.error.mockReset()
})

describe('useComposerSubmit', () => {
  it('does nothing when prompt is empty/whitespace', async () => {
    const c = useComposerSubmit(() => 1)
    await c.submit('   ')
    expect(createTaskMock).not.toHaveBeenCalled()
    expect(c.submitting.value).toBe(false)
    expect(c.error.value).toBe(null)
  })

  it('creates a task, clears the draft, and navigates on success', async () => {
    const c = useComposerSubmit(() => 1)
    await c.submit('hello world')
    expect(createTaskMock).toHaveBeenCalledWith(1, 'hello world', { mediaIds: [] })
    expect(clearDraftMock).toHaveBeenCalledWith(1)
    expect(pushMock).toHaveBeenCalledWith({ name: 'task', params: { id: 99 } })
    expect(c.submitting.value).toBe(false)
    expect(c.error.value).toBe(null)
  })

  it('trims surrounding whitespace before calling the store', async () => {
    const c = useComposerSubmit(() => 1)
    await c.submit('  hi  ')
    expect(createTaskMock).toHaveBeenCalledWith(1, 'hi', { mediaIds: [] })
  })

  it('surfaces an ApiError message via the error ref', async () => {
    const { ApiError } = await import('@/api/client')
    createTaskMock.mockRejectedValueOnce(new ApiError('rate limited', 'UNKNOWN', 400))
    const c = useComposerSubmit(() => 1)
    await c.submit('hi')
    expect(c.error.value).toBe('rate limited')
    expect(c.submitting.value).toBe(false)
  })

  it('falls back to a generic message for non-ApiError rejections', async () => {
    createTaskMock.mockRejectedValueOnce(new Error('boom'))
    const c = useComposerSubmit(() => 1)
    await c.submit('hi')
    expect(c.error.value).toBe('Failed to start task.')
    expect(c.submitting.value).toBe(false)
  })

  it('clears error on a subsequent successful submit', async () => {
    const c = useComposerSubmit(() => 1)
    createTaskMock.mockRejectedValueOnce(new Error('boom'))
    await c.submit('hi')
    expect(c.error.value).toBe('Failed to start task.')
    await c.submit('hi')
    expect(c.error.value).toBe(null)
  })

  it('resolves the agentId at submit time, not at setup (regression: route navigation reuses the composer)', async () => {
    // Regression for the in-place route navigation bug: vue-router
    // reuses the AgentPage (and ComposerInput) across `/agents/:id`
    // transitions, so the composable's setup runs once per mount. If
    // the composable captured the agentId there, switching agents in
    // the URL bar and submitting would still send the prompt to the
    // agent that was first mounted.
    let agentIdRef = 8
    const c = useComposerSubmit(() => agentIdRef)
    await c.submit('hi from 8')
    expect(createTaskMock).toHaveBeenLastCalledWith(8, 'hi from 8', { mediaIds: [] })

    agentIdRef = 42
    await c.submit('hi from 42')
    expect(createTaskMock).toHaveBeenLastCalledWith(42, 'hi from 42', { mediaIds: [] })

    expect(clearDraftMock).toHaveBeenCalledWith(8)
    expect(clearDraftMock).toHaveBeenCalledWith(42)
  })

  it('passes the reasoning-effort level to the store', async () => {
    const c = useComposerSubmit(() => 1, () => 'high')
    await c.submit('hello world')
    expect(createTaskMock).toHaveBeenCalledWith(1, 'hello world', {
      mediaIds: [],
      effort: 'high',
    })
  })

  it('sends the model default as an empty string', async () => {
    const c = useComposerSubmit(() => 1, () => '')
    await c.submit('hello world')
    expect(createTaskMock).toHaveBeenCalledWith(1, 'hello world', {
      mediaIds: [],
      effort: '',
    })
  })

  it('asks for the capability again when the backend refuses the level', async () => {
    const { ApiError } = await import('@/api/client')
    createTaskMock.mockRejectedValueOnce(
      new ApiError('level not supported', 'EFFORT_LEVEL_UNSUPPORTED', 422),
    )
    const reload = vi.fn()
    const c = useComposerSubmit(() => 1, () => 'xhigh', reload)

    await c.submit('hi')

    // The driver's level set moved on: the capability the client holds is
    // what the backend refused.
    expect(reload).toHaveBeenCalledWith(1)
    // The refusal still reaches the operator.
    expect(c.error.value).toBe('level not supported')
  })

  it('does not ask for the capability again when the request itself was malformed', async () => {
    const { ApiError } = await import('@/api/client')
    createTaskMock.mockRejectedValueOnce(new ApiError('malformed effort', 'INVALID_EFFORT', 422))
    const reload = vi.fn()
    const c = useComposerSubmit(() => 1, () => 'xhigh', reload)

    await c.submit('hi')

    // Nothing about the capability is stale: the caller has to fix the
    // request, and a reload would not help.
    expect(reload).not.toHaveBeenCalled()
    expect(c.error.value).toBe('malformed effort')
  })
})
