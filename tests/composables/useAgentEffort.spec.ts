/**
 * useAgentEffort — the agent's reasoning-effort capability.
 *
 * The capability is fetched per agent and cached for the session; the
 * *selection* lives in the agent store, because the initial composer and the
 * follow-up bar are two surfaces that have to agree on it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
}))

import { useAgentEffort, clearAgentEffortCache } from '@/composables/useAgentEffort'
import { useAgentStore } from '@/stores/agent'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useLlmPreferencesStore } from '@/stores/llmPreferencesStore'
import { useGroupDetailStore } from '@/stores/groupDetail'
import type { AgentEffort } from '@/types/effort'

function mockCapability(overrides: Partial<AgentEffort> = {}): void {
  apiMock.get.mockResolvedValueOnce({
    supported: true,
    levels: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ],
    default: 'high',
    ...overrides,
  })
}

/** A capability that only resolves when the test says so. */
function pendingCapability(): (payload: AgentEffort) => void {
  let resolve: (payload: AgentEffort) => void = () => undefined
  apiMock.get.mockImplementationOnce(() => new Promise<AgentEffort>((settle) => {
    resolve = settle
  }))
  return (payload) => resolve(payload)
}

/**
 * Answer the next capability request with a different level set — what the
 * operator gets when the agent's driver changed.
 */
async function changeCapability(
  composable: ReturnType<typeof useAgentEffort>,
  payload: Partial<AgentEffort>,
): Promise<void> {
  clearAgentEffortCache()
  mockCapability(payload)
  await composable.load(7)
}

/** The choices the picker offers: the model default plus the levels. */
function offeredChoices(composable: ReturnType<typeof useAgentEffort>): string[] {
  return ['', ...composable.levels.value.map(level => level.value)]
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.patch.mockReset()
  apiMock.post.mockReset()
  apiMock.put.mockReset()
  apiMock.patch.mockResolvedValue({ agent: { id: 7 } })
  apiMock.post.mockResolvedValue({ config: { id: 3, is_default: true } })
  apiMock.put.mockResolvedValue({ settings: {}, config: { id: 3 } })
  clearAgentEffortCache()
})

describe('useAgentEffort', () => {
  it('fetches the capability of the agent', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)

    expect(apiMock.get).toHaveBeenCalledWith('/agents/7/effort')
    expect(composable.supported.value).toBe(true)
    expect(composable.levels.value).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ])
  })

  it('falls back to the local label map for a level the endpoint did not label', async () => {
    mockCapability({ levels: [{ value: 'xhigh', label: '' }] })
    const composable = useAgentEffort()
    await composable.load(7)

    expect(composable.levels.value).toEqual([{ value: 'xhigh', label: 'xHigh' }])
  })

  it('preselects the default the endpoint reports', async () => {
    mockCapability({ default: 'high' })
    const composable = useAgentEffort()
    await composable.load(7)

    expect(composable.selection.value).toBe('high')
    expect(useAgentStore().getEffortSelection(7)).toBe('high')
  })

  it("lets the operator's choice win over the default", async () => {
    mockCapability({ default: 'high' })
    const composable = useAgentEffort()
    await composable.load(7)

    composable.select('low')

    expect(composable.selection.value).toBe('low')
    expect(useAgentStore().getEffortSelection(7)).toBe('low')
  })

  it('carries the model default as an empty string, not as the absence of one', async () => {
    mockCapability({ default: null })
    const composable = useAgentEffort()
    await composable.load(7)

    expect(composable.selection.value).toBe('')

    composable.select('')
    expect(composable.selection.value).toBe('')
    expect(useAgentStore().getEffortSelection(7)).toBe('')
  })

  it('offers no selection for an agent whose driver cannot express effort', async () => {
    mockCapability({ supported: false, levels: [], default: null })
    const composable = useAgentEffort()
    await composable.load(7)

    expect(composable.supported.value).toBe(false)
    expect(composable.levels.value).toEqual([])
    expect(composable.selection.value).toBeUndefined()
  })

  it('caches the capability per agent id', async () => {
    mockCapability()
    mockCapability()
    const composable = useAgentEffort()

    await composable.load(7)
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await composable.load(8)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
    expect(apiMock.get).toHaveBeenLastCalledWith('/agents/8/effort')
  })

  it('shares the selection with a second surface on the same agent', async () => {
    mockCapability()
    const composer = useAgentEffort()
    await composer.load(7)
    composer.select('low')

    const followup = useAgentEffort()
    await followup.load(7)

    expect(followup.selection.value).toBe('low')
  })

  it('swallows a failed request but not a broken collaborator', async () => {
    const composable = useAgentEffort()

    // The picker is optional: a failed request leaves it hidden rather
    // than breaking the composer it sits in.
    apiMock.get.mockRejectedValueOnce(new Error('network down'))
    await expect(composable.load(7)).resolves.toBeUndefined()
    expect(composable.selection.value).toBeUndefined()

    // A collaborator that throws is a bug, not a capability that could not
    // be fetched: it has to reach whoever called, or a broken collaborator
    // passes for a working one.
    const store = useAgentStore()
    const spy = vi.spyOn(store, 'clearEffortSelection').mockImplementation(() => {
      throw new TypeError('broken collaborator')
    })
    mockCapability({ supported: false, levels: [], default: null })

    await expect(composable.load(8)).rejects.toThrow('broken collaborator')
    spy.mockRestore()
  })

  it('does not let a cached capability overwrite a choice that was already made', async () => {
    mockCapability()
    const first = useAgentEffort()
    await first.load(7)
    first.select('low')

    clearAgentEffortCache()
    mockCapability()
    const second = useAgentEffort()
    await second.load(7)

    expect(second.selection.value).toBe('low')
  })

  it("does not carry the previous agent's level over to the next one", async () => {
    mockCapability({ default: 'high' })
    const composable = useAgentEffort()
    await composable.load(7)
    expect(composable.selection.value).toBe('high')

    mockCapability({ supported: false, levels: [], default: null })
    const pending = composable.load(8)
    // The new agent's capability is not known yet, so the chat carries no
    // level at all — the previous agent's would be a level this agent's
    // driver may not accept.
    expect(composable.selection.value).toBeUndefined()
    await pending
    expect(composable.selection.value).toBeUndefined()
  })

  it('does not adopt a capability that arrives after the operator switched agents', async () => {
    const resolveFirst = pendingCapability()
    // The agent the operator switched to has a driver that cannot express
    // effort at all.
    mockCapability({ supported: false, levels: [], default: null })

    const composable = useAgentEffort()
    const firstAgent = composable.load(1)
    await composable.load(2)
    expect(composable.supported.value).toBe(false)

    resolveFirst({
      supported: true,
      levels: [{ value: 'high', label: 'High' }],
      default: 'high',
    })
    await firstAgent

    // The late answer belongs to the agent the operator left. Adopting it
    // would offer the first agent's levels for the second one and default
    // to a level its driver does not accept.
    expect(composable.supported.value).toBe(false)
    expect(composable.levels.value).toEqual([])
    expect(composable.selection.value).toBeUndefined()
  })

  it('asks the backend again after the agent\'s LLM configuration changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await useAgentStore().putLLMConfig(7, { 'core.openai.api_key': 'sk-test' })

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('asks the backend again after the agent\'s driver changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await useAgentStore().updateAgent(7, { llm_driver_config_id: 12 })

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the cached capability when an unrelated field of the agent changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)

    await useAgentStore().updateAgent(7, { name: 'Renamed' })

    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)
  })

  it('asks the backend again when the capability is refreshed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    // The refresh has to bypass the cache: the cached answer is what the
    // backend refused.
    await composable.refresh(7)

    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('reconciles the selection against the refreshed capability', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    mockCapability({
      default: 'medium',
      levels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
      ],
    })
    await composable.refresh(7)

    // The level the driver no longer offers is gone, so the next message
    // does not carry it.
    expect(composable.selection.value).toBe('medium')
  })

  it('asks the backend again after the user signed out', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    // The router calls this on sign-out and whenever the signed-in user
    // drifts away from the one the cache was filled for.
    useAgentStore().markStale()

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('does not answer from an answer that was already on the wire when the configuration changed', async () => {
    const resolveFirst = pendingCapability()

    const composable = useAgentEffort()
    const onTheWire = composable.load(7)

    await useAgentStore().putLLMConfig(7, { 'core.openai.api_key': 'sk-test' })

    resolveFirst({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }],
      default: 'low',
    })
    await onTheWire

    // The answer that arrives now describes the configuration as it was
    // before the change, so it must not become the cached capability.
    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('asks the backend again after the LLM configuration itself changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    // The configuration's model decides the level set and its `effort`
    // setting is the default, so every agent that runs on it has to ask
    // again.
    await useLlmConfigsStore().updateConfig(3, { settings: { 'core.openai.model': 'gpt-5' } })

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('asks the backend again after the global default configuration changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await useLlmConfigsStore().setDefault(3)

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('asks the backend again after the preferred configuration changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await useLlmPreferencesStore().setPreference(3)

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  it('asks the backend again after a group\'s LLM configuration changed', async () => {
    mockCapability()
    const composable = useAgentEffort()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)

    await useGroupDetailStore().updateLlmConfig(4, 3, { settings: { 'core.openai.model': 'gpt-5' } })

    mockCapability()
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })
})

describe('useAgentEffort — the selection against the offered levels', () => {
  it('keeps a selection the new capability still offers', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    await changeCapability(composable, {
      levels: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'xHigh' },
      ],
      default: 'low',
    })

    expect(composable.selection.value).toBe('high')
    expect(useAgentStore().getEffortSelection(7)).toBe('high')
  })

  it('drops a selection the new capability does not offer', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    await changeCapability(composable, {
      levels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
      ],
      default: 'medium',
    })

    // 'high' is not on offer any more, and the backend rejects a level the
    // driver does not declare.
    expect(composable.selection.value).toBe('medium')
    expect(useAgentStore().getEffortSelection(7)).toBe('medium')
  })

  it('keeps the model default across a capability change', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('')

    await changeCapability(composable, {
      levels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
      ],
      default: 'medium',
    })

    // The model default is not a level: no driver rejects it.
    expect(composable.selection.value).toBe('')
    expect(useAgentStore().getEffortSelection(7)).toBe('')
  })

  it('clears the selection when the driver speaks no effort', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    await changeCapability(composable, { supported: false, levels: [], default: null })

    // There is no picker, so there is no choice — and the chat carries no
    // effort at all, exactly as it does while the capability is unknown.
    expect(useAgentStore().getEffortSelection(7)).toBeUndefined()
    expect(composable.selection.value).toBeUndefined()
    expect(composable.supported.value).toBe(false)
  })

  it('offers a value the picker can show after the capability changed', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    await changeCapability(composable, {
      levels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
      ],
      default: 'medium',
    })

    expect(offeredChoices(composable)).toContain(composable.selection.value)
  })

  it('falls back to the model default when the new default is not on offer', async () => {
    mockCapability({ default: 'low' })
    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('high')

    await changeCapability(composable, {
      levels: [{ value: 'low', label: 'Low' }],
      default: 'xhigh',
    })

    expect(composable.selection.value).toBe('')
    expect(offeredChoices(composable)).toContain(composable.selection.value)
  })
})
