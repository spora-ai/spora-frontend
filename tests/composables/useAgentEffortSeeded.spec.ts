/**
 * The agent's own default, and the chat's level.
 *
 * Two facts have to be kept apart: a level the operator picked is theirs,
 * and a level the capability's default seeded follows the default. The
 * seeded one has to move when the default moves — including when the
 * default moved because the agent was pointed at another configuration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message)
      this.name = 'ApiError'
    }
  },
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

import { useAgentEffort } from '@/composables/useAgentEffort'
import { useAgentStore } from '@/stores/agent'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'
import { api } from '@/api/client'
import type { AgentEffort } from '@/types/effort'

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>

function capability(overrides: Partial<AgentEffort> = {}): AgentEffort {
  return {
    supported: true,
    levels: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ],
    default: 'low',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockedGet.mockReset()
  clearAgentEffortCache()
})

describe('the seeded level follows the default', () => {
  it('follows the default when the capability reports a different one', async () => {
    mockedGet.mockResolvedValue(capability({ default: 'high' }))

    const composable = useAgentEffort()
    await composable.load(7)

    // Nothing was picked, so the capability's default seeds the level.
    expect(composable.selection.value).toBe('high')
  })

  it('follows the default when it moves and the old level is still on offer', async () => {
    mockedGet.mockResolvedValue(capability({ default: 'low' }))

    const composable = useAgentEffort()
    await composable.load(7)
    expect(composable.selection.value).toBe('low')

    // The agent was pointed at another configuration, whose default is
    // different. The seeded level was never the operator's, so it moves.
    const store = useAgentStore()
    store.seedEffortSelection(7, 'low')

    mockedGet.mockResolvedValue(capability({ default: 'high' }))
    await composable.refresh(7)

    expect(composable.selection.value).toBe('high')
  })

  it('leaves a level the operator picked alone', async () => {
    mockedGet.mockResolvedValue(capability({ default: 'low' }))

    const composable = useAgentEffort()
    await composable.load(7)
    composable.select('low')

    mockedGet.mockResolvedValue(capability({ default: 'high' }))
    await composable.refresh(7)

    expect(composable.selection.value).toBe('low')
  })
})
