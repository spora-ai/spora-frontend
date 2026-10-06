import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '@/api/client'
import { searchApi } from '@/api/search'

const mockApi = api as ReturnType<typeof vi.fn>

const mockHit = {
  type: 'skill',
  id: 'invoice',
  label: 'Invoice skill',
  subLabel: 'Reads invoices',
  badge: null,
  href: '/apps/media-archive/skill/invoice',
}

describe('searchApi', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('search fetches /search with the query as ?q', async () => {
    mockApi.get.mockResolvedValueOnce({ hits: [mockHit], query: 'invoice' })
    const response = await searchApi.search('invoice')
    expect(response).toEqual({ hits: [mockHit], query: 'invoice' })
    expect(mockApi.get).toHaveBeenCalledWith('/search', { q: 'invoice' })
  })

  it('search returns an empty hit list unchanged', async () => {
    mockApi.get.mockResolvedValueOnce({ hits: [], query: 'zzz' })
    const response = await searchApi.search('zzz')
    expect(response.hits).toEqual([])
    expect(response.query).toBe('zzz')
  })

  it('search propagates a rejection so the caller can decide what to do', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('500'))
    await expect(searchApi.search('invoice')).rejects.toThrow('500')
  })
})