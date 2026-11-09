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
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
}))

import { useAgentEffort, clearAgentEffortCache } from '@/composables/useAgentEffort'
import { useAgentStore } from '@/stores/agent'
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

beforeEach(() => {
  apiMock.get.mockReset()
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

  it('leaves the selection unknown when the capability could not be fetched', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('network down'))
    const composable = useAgentEffort()

    await expect(composable.load(7)).rejects.toThrow('network down')
    expect(composable.selection.value).toBeUndefined()
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
})
