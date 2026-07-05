/**
 * plugins API client — wraps api.{get,post,delete,patch}. Routes:
 * getPlugins → GET /plugins, installPlugin → POST /plugins,
 * uninstallPlugin/updatePlugin → DELETE|PATCH /plugins/{slug}.
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
  it('POSTs to /plugins with the request body and unwraps data', async () => {
    postMock.mockResolvedValueOnce({
      data: { package: 'spora-ai/spora-plugin-tavily', status: 'installed', constraint: '^0.2' },
    })
    const result = await installPlugin({ package: 'spora-ai/spora-plugin-tavily', constraint: '^0.2' })
    expect(postMock).toHaveBeenCalledWith('/plugins', { package: 'spora-ai/spora-plugin-tavily', constraint: '^0.2' })
    expect(result).toEqual({ package: 'spora-ai/spora-plugin-tavily', status: 'installed', constraint: '^0.2' })
  })
})

describe('uninstallPlugin', () => {
  it('DELETEs /plugins/{package} with URL-encoded package', async () => {
    deleteMock.mockResolvedValueOnce({
      data: { package: 'spora-ai/spora-plugin-tavily', status: 'uninstalled' },
    })
    const result = await uninstallPlugin('spora-ai/spora-plugin-tavily')
    expect(deleteMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily')
    expect(result.status).toBe('uninstalled')
  })

  it('URL-encodes special characters in the package name', async () => {
    deleteMock.mockResolvedValueOnce({ data: { package: 'foo/bar', status: 'uninstalled' } })
    await uninstallPlugin('foo bar/baz')
    expect(deleteMock).toHaveBeenCalledWith('/plugins/foo%20bar%2Fbaz')
  })
})

describe('updatePlugin', () => {
  it('PATCHes /plugins/{package} with the request body', async () => {
    patchMock.mockResolvedValueOnce({
      data: { package: 'spora-ai/spora-plugin-tavily', status: 'updated', constraint: '^0.3' },
    })
    const result = await updatePlugin('spora-ai/spora-plugin-tavily', { constraint: '^0.3' })
    expect(patchMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily', { constraint: '^0.3' })
    expect(result.status).toBe('updated')
  })

  it('passes an empty body when no constraint is supplied', async () => {
    patchMock.mockResolvedValueOnce({ data: { package: 'spora-ai/spora-plugin-tavily', status: 'updated' } })
    await updatePlugin('spora-ai/spora-plugin-tavily')
    expect(patchMock).toHaveBeenCalledWith('/plugins/spora-ai%2Fspora-plugin-tavily', {})
  })
})