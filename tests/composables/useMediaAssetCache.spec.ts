/**
 * useMediaAssetCache — module-level batch resolver for the chat list's
 * attachment rendering. Mocks `api.post` so we can drive the resolve
 * endpoint without booting a backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const postMock = vi.fn()
vi.mock('@/api/client', () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

import { useMediaAssetCache, clearMediaAssetCache } from '@/composables/useMediaAssetCache'
import type { MediaAsset } from '@/types/media'

function asset(id: string, partial: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    filename: `${id}.png`,
    media_type: 'image',
    mime_type: 'image/png',
    byte_size: 1024,
    asset_url: `https://example.test/${id}`,
    has_markdown: false,
    ...partial,
  }
}

beforeEach(() => {
  clearMediaAssetCache()
  postMock.mockReset()
})

describe('useMediaAssetCache', () => {
  describe('batchResolve', () => {
    it('returns an empty map for an empty id list without hitting the network', async () => {
      const cache = useMediaAssetCache()
      const result = await cache.batchResolve([])
      expect(result.size).toBe(0)
      expect(postMock).not.toHaveBeenCalled()
    })

    it('POSTs to /media/resolve and indexes the response by id', async () => {
      postMock.mockResolvedValue({
        data: {
          assets: [asset('a'), asset('b')],
        },
      })
      const cache = useMediaAssetCache()
      const result = await cache.batchResolve(['a', 'b'])
      expect(postMock).toHaveBeenCalledWith('/media/resolve', { ids: ['a', 'b'] })
      expect(result.get('a')?.filename).toBe('a.png')
      expect(result.get('b')?.filename).toBe('b.png')
    })

    it('serves cached ids without a network round trip', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      await cache.batchResolve(['a'])
      expect(postMock).toHaveBeenCalledTimes(1)

      postMock.mockClear()
      await cache.batchResolve(['a'])
      expect(postMock).not.toHaveBeenCalled()
    })

    it('only fetches unknown ids when mixing cached + fresh ids', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      await cache.batchResolve(['a'])

      postMock.mockResolvedValueOnce({ data: { assets: [asset('b')] } })
      const result = await cache.batchResolve(['a', 'b'])
      expect(postMock).toHaveBeenCalledTimes(2)
      expect(postMock.mock.calls[1]).toEqual(['/media/resolve', { ids: ['b'] }])
      expect(result.get('a')?.filename).toBe('a.png')
      expect(result.get('b')?.filename).toBe('b.png')
    })

    it('silently drops ids that are not in the response (existence-hiding)', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      const result = await cache.batchResolve(['a', '00000000-0000-4000-8000-000000000000'])
      expect(result.has('a')).toBe(true)
      expect(result.size).toBe(1)
    })

    it('dedupes the input id list before sending', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      await cache.batchResolve(['a', 'a', 'a'])
      expect(postMock).toHaveBeenCalledWith('/media/resolve', { ids: ['a'] })
    })

    it('chunks requests at 64 ids per call', async () => {
      const ids: string[] = []
      for (let i = 0; i < 100; i++) {
        ids.push(`00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`)
      }
      const firstChunk = ids.slice(0, 64)
      const secondChunk = ids.slice(64)
      postMock
        .mockResolvedValueOnce({ data: { assets: firstChunk.map((id) => asset(id)) } })
        .mockResolvedValueOnce({ data: { assets: secondChunk.map((id) => asset(id)) } })

      const cache = useMediaAssetCache()
      const result = await cache.batchResolve(ids)
      expect(postMock).toHaveBeenCalledTimes(2)
      expect(postMock.mock.calls[0][1]).toEqual({ ids: firstChunk })
      expect(postMock.mock.calls[1][1]).toEqual({ ids: secondChunk })
      expect(result.size).toBe(100)
    })
  })

  describe('get', () => {
    it('returns null for an unknown id', () => {
      const cache = useMediaAssetCache()
      expect(cache.get('missing')).toBeNull()
    })

    it('returns the previously resolved asset', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      await cache.batchResolve(['a'])
      const hit = cache.get('a')
      expect(hit?.filename).toBe('a.png')
    })

    it('reflects a clearMediaAssetCache', async () => {
      postMock.mockResolvedValueOnce({ data: { assets: [asset('a')] } })
      const cache = useMediaAssetCache()
      await cache.batchResolve(['a'])
      expect(cache.get('a')).not.toBeNull()
      clearMediaAssetCache()
      expect(cache.get('a')).toBeNull()
    })
  })
})
