/**
 * useMediaAllowedTypes — caches the dynamic upload allowlist per agent.
 *
 * The composable is keyed by `agentId` so switching agents on the
 * composer invalidates the cache and re-issues the `?agent_id=…`
 * probe. The extension list it produces is used as the
 * `<input type="file" accept>` value, which requires each entry to
 * start with a dot (`text/plain` → `.txt`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: apiMock,
}))

import {
  useMediaAllowedTypes,
  clearMediaAllowedTypesCache,
} from '@/composables/useMediaAllowedTypes'

// Re-export to make the "no agent" id stable across test cases.
import { beforeAll, afterAll } from 'vitest'

function mockResponse(extensions: string[]): void {
  apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions })
}

describe('useMediaAllowedTypes', () => {
  beforeEach(() => {
    apiMock.get.mockReset()
    clearMediaAllowedTypesCache()
  })

  it('prefixes each extension with a dot for the accept attribute', async () => {
    mockResponse(['txt', 'pdf'])
    const composable = useMediaAllowedTypes()
    await composable.load()
    expect(composable.extensionList()).toBe('.txt,.pdf')
  })

  it('caches the response per agentId so a second call does not re-fetch', async () => {
    mockResponse(['pdf'])
    const composable = useMediaAllowedTypes()
    await composable.load(7)
    await composable.load(7)
    expect(apiMock.get).toHaveBeenCalledTimes(1)
  })

  it('issues a fresh fetch when the agentId changes', async () => {
    mockResponse(['pdf'])
    mockResponse(['png'])
    const composable = useMediaAllowedTypes()
    await composable.load(1)
    await composable.load(2)
    expect(apiMock.get).toHaveBeenCalledTimes(2)
    expect(apiMock.get).toHaveBeenNthCalledWith(1, '/media/allowed-types?agent_id=1')
    expect(apiMock.get).toHaveBeenNthCalledWith(2, '/media/allowed-types?agent_id=2')
  })

  it('returns an empty extension list when nothing is loaded', () => {
    const composable = useMediaAllowedTypes()
    expect(composable.extensionList()).toBe('')
  })

  it('omits the agent query when no agentId is provided', async () => {
    mockResponse(['txt'])
    const composable = useMediaAllowedTypes()
    await composable.load()
    expect(apiMock.get).toHaveBeenCalledWith('/media/allowed-types')
  })
})
