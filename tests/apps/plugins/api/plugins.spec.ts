/**
 * plugins API client — wraps api.{get,post,delete,patch}. Routes:
 * getPlugins → GET /plugins, installPlugin → POST /plugins,
 * uninstallPlugin/updatePlugin → DELETE|PATCH /plugins/{package},
 * getCatalog → GET /plugins/catalog.
 *
 * The api client auto-unwraps `{data: ...}` envelopes (see
 * `src/api/client.ts` `body.data ?? body`), so the api functions return
 * the inner object directly. The mocks below match that shape — wrapping
 * in `{data: ...}` would mock the pre-unwrap form and hide bugs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock, postMock, deleteMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
  patchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    get: getMock,
    post: postMock,
    delete: deleteMock,
    patch: patchMock,
  },
}))

import {
  getCatalog,
  getPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
} from '@/apps/plugins/api/plugins'

beforeEach(() => {
  getMock.mockReset()
  postMock.mockReset()
  deleteMock.mockReset()
  patchMock.mockReset()
})

const fixture = [
  {
    slug: 'minimax',
    name: 'MiniMax',
    package: 'spora-ai/spora-plugin-minimax',
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

describe('getPlugins', () => {
  it('calls /plugins and unwraps the data.plugins array', async () => {
    getMock.mockResolvedValueOnce({ plugins: fixture })
    expect(await getPlugins()).toBe(fixture)
    expect(getMock).toHaveBeenCalledWith('/plugins')
  })

  it('returns an empty array when the API returns no plugins', async () => {
    getMock.mockResolvedValueOnce({ plugins: [] })
    expect(await getPlugins()).toEqual([])
  })
})

describe('installPlugin', () => {
  it('POSTs to /plugins with the request body and returns the unwrapped result', async () => {
    postMock.mockResolvedValueOnce({
      package: 'spora-ai/spora-plugin-tavily',
      status: 'installed',
      constraint: '^0.2',
    })
    const result = await installPlugin({ package: 'spora-ai/spora-plugin-tavily', constraint: '^0.2' })
    expect(postMock).toHaveBeenCalledWith('/plugins', { package: 'spora-ai/spora-plugin-tavily', constraint: '^0.2' })
    expect(result).toEqual({ package: 'spora-ai/spora-plugin-tavily', status: 'installed', constraint: '^0.2' })
  })

  // Regression: the api functions used to do `result.data` after the api
  // client had already auto-unwrapped, so callers got `undefined` and
  // crashed on `result.package`. The mock here matches the unwrapped form
  // the real api client returns; the previous `{data: ...}` wrap was a
  // masked contract violation.
  it('returns the api.post value as-is — no second .data unwrap', async () => {
    postMock.mockResolvedValueOnce({
      package: 'spora-ai/spora-plugin-tavily',
      status: 'installed',
    })
    const result = await installPlugin({ package: 'spora-ai/spora-plugin-tavily' })
    expect(result.package).toBe('spora-ai/spora-plugin-tavily')
  })
})

describe('uninstallPlugin', () => {
  it('DELETEs /plugins/{package} with URL-encoded package', async () => {
    deleteMock.mockResolvedValueOnce({
      package: 'spora-ai/spora-plugin-tavily',
      status: 'uninstalled',
    })
    const result = await uninstallPlugin('spora-ai/spora-plugin-tavily')
    expect(deleteMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily')
    expect(result.status).toBe('uninstalled')
    expect(result.package).toBe('spora-ai/spora-plugin-tavily')
  })

  it('URL-encodes special characters in the package name', async () => {
    deleteMock.mockResolvedValueOnce({ package: 'foo/bar', status: 'uninstalled' })
    await uninstallPlugin('foo bar/baz')
    expect(deleteMock).toHaveBeenCalledWith('/plugins/foo%20bar%2Fbaz')
  })
})

describe('updatePlugin', () => {
  it('PATCHes /plugins/{package} with the request body', async () => {
    patchMock.mockResolvedValueOnce({
      package: 'spora-ai/spora-plugin-tavily',
      status: 'updated',
      constraint: '^0.3',
    })
    const result = await updatePlugin('spora-ai/spora-plugin-tavily', { constraint: '^0.3' })
    expect(patchMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily', { constraint: '^0.3' })
    expect(result.status).toBe('updated')
  })

  it('passes an empty body when no constraint is supplied', async () => {
    patchMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'updated' })
    await updatePlugin('spora-ai/spora-plugin-tavily')
    expect(patchMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily', {})
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