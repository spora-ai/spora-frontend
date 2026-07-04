/**
 * useCatalogStore — Browse tab state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { getCatalogMock } = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/api/plugins', () => ({
  getCatalog: getCatalogMock,
}))

import { useCatalogStore } from '@/apps/plugins/stores/catalog'
import { ApiError } from '@/api/client'

beforeEach(() => {
  setActivePinia(createPinia())
  getCatalogMock.mockReset()
})

const fixture = {
  packages: [
    {
      name: 'spora-ai/spora-plugin-tavily',
      description: 'Web search via Tavily',
      version: '0.2.2',
      downloads: 5000,
      favorites: 7,
      repository: 'https://github.com/spora-ai/spora-plugin-tavily',
      homepage: null,
    },
  ],
  cached_at: 1720000000,
  ttl_seconds: 3600,
}

describe('useCatalogStore — search()', () => {
  it('calls getCatalog and stores the result', async () => {
    getCatalogMock.mockResolvedValueOnce(fixture)
    const store = useCatalogStore()
    await store.search('tavily')

    expect(getCatalogMock).toHaveBeenCalledWith('tavily')
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.packages).toEqual(fixture.packages)
    expect(store.cachedAt).toBe(1720000000)
    expect(store.ttlSeconds).toBe(3600)
    expect(store.query).toBe('tavily')
  })

  it('trims whitespace from the query before calling getCatalog', async () => {
    getCatalogMock.mockResolvedValueOnce(fixture)
    const store = useCatalogStore()
    await store.search('  tavily  ')

    expect(getCatalogMock).toHaveBeenCalledWith('tavily')
    expect(store.query).toBe('tavily')
  })

  it('clears the previous error on a new search', async () => {
    getCatalogMock.mockRejectedValueOnce(new Error('boom'))
    const store = useCatalogStore()
    await store.search('first')
    expect(store.error).toBe('Failed to load catalog.')

    getCatalogMock.mockResolvedValueOnce(fixture)
    await store.search('tavily')
    expect(store.error).toBeNull()
  })

  it('sets the error from ApiError rejections', async () => {
    getCatalogMock.mockRejectedValueOnce(new ApiError('Catalog offline', 'SERVICE_UNAVAILABLE', 503))
    const store = useCatalogStore()
    await store.search('tavily')
    expect(store.error).toBe('Catalog offline')
    expect(store.packages).toEqual([])
    expect(store.cachedAt).toBeNull()
  })

  it('sets a generic error for non-ApiError rejections', async () => {
    getCatalogMock.mockRejectedValueOnce(new Error('Network'))
    const store = useCatalogStore()
    await store.search('tavily')
    expect(store.error).toBe('Failed to load catalog.')
  })

  it('clears packages + cache on error', async () => {
    getCatalogMock.mockResolvedValueOnce(fixture)
    const store = useCatalogStore()
    await store.search('tavily')
    expect(store.packages.length).toBe(1)

    getCatalogMock.mockRejectedValueOnce(new Error('boom'))
    await store.search('again')
    expect(store.packages).toEqual([])
    expect(store.cachedAt).toBeNull()
  })

  it('replaces packages with the new result (no merge)', async () => {
    getCatalogMock.mockResolvedValueOnce(fixture)
    const store = useCatalogStore()
    await store.search('tavily')
    expect(store.packages).toEqual(fixture.packages)

    const newFixture = {
      packages: [fixture.packages[0], fixture.packages[0]],  // deduped by backend in real life
      cached_at: 1720001000,
      ttl_seconds: 3600,
    }
    getCatalogMock.mockResolvedValueOnce(newFixture)
    await store.search('tavily')
    expect(store.packages).toEqual(newFixture.packages)
  })
})

describe('useCatalogStore — clearError()', () => {
  it('clears the error', async () => {
    getCatalogMock.mockRejectedValueOnce(new Error('boom'))
    const store = useCatalogStore()
    await store.search('tavily')
    expect(store.error).toBe('Failed to load catalog.')

    store.clearError()
    expect(store.error).toBeNull()
  })
})