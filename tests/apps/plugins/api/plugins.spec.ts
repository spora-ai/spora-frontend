/**
 * plugins API client — thin wrapper over the shared api.get helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { get: getMock },
}))

import { getCatalog, getPlugins } from '@/apps/plugins/api/plugins'

beforeEach(() => {
  getMock.mockReset()
})

describe('getPlugins', () => {
  it('calls /plugins and unwraps the data.plugins array', async () => {
    const fixture = [
      {
        slug: 'minimax',
        name: 'MiniMax',
        description: '',
        icon: 'puzzle',
        version: 1,
        path: '/plugins/minimax',
        bundledTools: [],
        bundledDrivers: [],
        recipePaths: [],
        migrations: { declared: 1, applied: 1, filesOnDisk: 1, pending: 0, lastAppliedAt: null, status: 'up_to_date' as const },
      },
    ]
    getMock.mockResolvedValueOnce({ plugins: fixture })

    const result = await getPlugins()

    expect(getMock).toHaveBeenCalledWith('/plugins')
    expect(result).toBe(fixture)
  })

  it('returns an empty array when the API returns no plugins', async () => {
    getMock.mockResolvedValueOnce({ plugins: [] })

    const result = await getPlugins()

    expect(result).toEqual([])
  })
})

describe('getCatalog', () => {
  it('calls /plugins/catalog with the encoded query and returns the unwrapped response', async () => {
    const fixture = {
      packages: [
        {
          name: 'spora-ai/spora-plugin-email',
          description: 'IMAP/SMTP for Spora',
          version: '0.2.1',
          downloads: 1234,
          favorites: 12,
          repository: 'https://github.com/spora-ai/spora-plugin-email',
          homepage: null,
        },
      ],
      cached_at: 1720000000,
      ttl_seconds: 3600,
    }
    getMock.mockResolvedValueOnce(fixture)

    const result = await getCatalog('email')

    expect(getMock).toHaveBeenCalledWith('/plugins/catalog?q=email')
    expect(result).toEqual(fixture)
  })

  it('encodes special characters in the query', async () => {
    getMock.mockResolvedValueOnce({ packages: [], cached_at: 0, ttl_seconds: 3600 })
    await getCatalog('foo & bar')
    expect(getMock).toHaveBeenCalledWith('/plugins/catalog?q=foo+%26+bar')
  })

  it('sends an empty q= for blank queries', async () => {
    getMock.mockResolvedValueOnce({ packages: [], cached_at: 0, ttl_seconds: 3600 })
    await getCatalog('')
    expect(getMock).toHaveBeenCalledWith('/plugins/catalog?q=')
  })

  it('returns empty packages + zero cache when the catalog has no results', async () => {
    getMock.mockResolvedValueOnce({ packages: [], cached_at: 0, ttl_seconds: 3600 })
    const result = await getCatalog('nothing-matches-this-query')
    expect(result.packages).toEqual([])
    expect(result.cached_at).toBe(0)
  })
})
