/**
 * useAgentLlmConfig — the LLM configuration an agent runs on.
 *
 * The composable asks `GET /api/v1/llm-configs/effective?agent_id=N` and
 * builds the label from the tier the endpoint names. The mapping is pinned
 * here: a change in the backend's vocabulary has to fail loudly rather than
 * quietly drop the wording that tells the operator which tier won.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code = '',
      public readonly status = 0,
    ) {
      super(message)
    }
  },
}))

import { useAgentLlmConfig } from '@/composables/useAgentLlmConfig'
import type { LLMConfigResource, LLMConfigSource } from '@/types/llmConfig'

const config = (name: string): LLMConfigResource => ({
  id: 7,
  name,
  driver_class: 'OpenAI',
  driver_name: 'openai_compatible',
  driver_display_name: 'OpenAI',
  settings: {},
  context_window: null,
  max_tokens_output: null,
  is_default: false,
  is_global: false,
  principal_id: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

beforeEach(() => {
  apiMock.get.mockReset()
})

describe('useAgentLlmConfig', () => {
  it('asks the endpoint for the agent it was pointed at', async () => {
    apiMock.get.mockResolvedValueOnce({ config: config('Team OpenAI'), source: 'group_preference' })

    const llm = useAgentLlmConfig()
    await llm.load(42)

    expect(apiMock.get).toHaveBeenCalledWith('/llm-configs/effective', { agent_id: 42 })
    expect(llm.config.value?.name).toBe('Team OpenAI')
    expect(llm.source.value).toBe('group_preference')
  })

  it('says nothing until the endpoint has answered', async () => {
    let resolve: (value: unknown) => void = () => undefined
    apiMock.get.mockReturnValueOnce(new Promise((r) => { resolve = r }))

    const llm = useAgentLlmConfig()
    // Before the first request the effective configuration is unknown —
    // "nothing is configured" would be a claim nobody made yet.
    expect(llm.label.value).toBe('')

    const pending = llm.load(1)
    expect(llm.label.value).toBe('')
    expect(llm.loading.value).toBe(true)

    resolve({ config: config('Team OpenAI'), source: 'group_preference' })
    await pending
    expect(llm.label.value).toBe('Team OpenAI (group preferred)')
  })

  it.each<[LLMConfigSource, string]>([
    ['agent', 'Team OpenAI'],
    ['user_preference', 'Team OpenAI (preferred)'],
    ['group_preference', 'Team OpenAI (group preferred)'],
    ['user_default', 'Team OpenAI (default)'],
    ['group_default', 'Team OpenAI (group default)'],
    ['global_default', 'Team OpenAI (global default)'],
  ])('renders the %s tier as "%s"', async (source, expected) => {
    apiMock.get.mockResolvedValueOnce({ config: config('Team OpenAI'), source })

    const llm = useAgentLlmConfig()
    await llm.load(1)

    expect(llm.label.value).toBe(expected)
  })

  it('says that nothing is configured when the endpoint names no tier', async () => {
    apiMock.get.mockResolvedValueOnce({ config: null, source: 'none' })

    const llm = useAgentLlmConfig()
    await llm.load(1)

    expect(llm.label.value).toBe('No LLM configuration')
  })

  it('claims nothing when the lookup fails', async () => {
    // A stranger gets a 404, and a backend without the endpoint answers 422.
    // Neither may throw out of the composable — and neither may claim that
    // nothing is configured: the server never said so, and the agent may
    // well have a configuration this caller simply cannot see.
    apiMock.get.mockRejectedValueOnce(new Error('not found'))

    const llm = useAgentLlmConfig()
    await expect(llm.load(1)).resolves.toBeUndefined()

    expect(llm.config.value).toBeNull()
    expect(llm.source.value).toBe('none')
    expect(llm.failed.value).toBe(true)
    expect(llm.label.value).toBe('')
    expect(llm.loading.value).toBe(false)
  })

  it('recovers the claim after a failed load is followed by a good one', async () => {
    // The failure belongs to the request it answered, not to the agent.
    apiMock.get
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ config: config('Team OpenAI'), source: 'group_preference' })

    const llm = useAgentLlmConfig()
    await llm.load(1)
    expect(llm.failed.value).toBe(true)

    await llm.load(1)
    expect(llm.failed.value).toBe(false)
    expect(llm.label.value).toBe('Team OpenAI (group preferred)')
  })

  it('does not qualify a configuration with a tier it does not know', async () => {
    // A vocabulary this build does not know earns no wording — the name is
    // still true, only the qualification of it would be a guess.
    apiMock.get.mockResolvedValueOnce({ config: config('Team OpenAI'), source: 'quantum_default' })

    const llm = useAgentLlmConfig()
    await llm.load(1)

    expect(llm.label.value).toBe('Team OpenAI')
  })

  it('ignores an answer that arrives after the operator moved on', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    apiMock.get
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ config: config('Second Agent Config'), source: 'agent' })

    const llm = useAgentLlmConfig()
    const first = llm.load(1)
    const second = llm.load(2)

    // The surface shows the second agent, so the first one's answer must not
    // fill it in the meantime.
    expect(llm.label.value).toBe('')

    resolveFirst({ config: config('First Agent Config'), source: 'agent' })
    await Promise.all([first, second])

    // The late answer describes an agent the surface no longer shows.
    expect(llm.config.value?.name).toBe('Second Agent Config')
    expect(llm.label.value).toBe('Second Agent Config')
  })

  it('ignores a late failure of an older load of the same agent', async () => {
    // Two loads of the same agent share its id, so the id alone cannot tell
    // a stale answer from the current one.
    let rejectFirst: (reason: unknown) => void = () => undefined
    apiMock.get
      .mockReturnValueOnce(new Promise((_r, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce({ config: config('Team OpenAI'), source: 'group_preference' })

    const llm = useAgentLlmConfig()
    const first = llm.load(7)
    const second = llm.load(7)

    rejectFirst(new Error('too late'))
    await Promise.all([first, second])

    expect(llm.config.value?.name).toBe('Team OpenAI')
    expect(llm.label.value).toBe('Team OpenAI (group preferred)')
  })
})
