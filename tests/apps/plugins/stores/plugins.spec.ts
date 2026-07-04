/**
 * plugins store — load() + the new install/uninstall/update actions.
 *
 * The store reloads the inventory after every successful mutation so the
 * page reflects the new state without the caller needing to call load().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const {
  getPluginsMock,
  installMock,
  uninstallMock,
  updateMock,
} = vi.hoisted(() => ({
  getPluginsMock: vi.fn(),
  installMock: vi.fn(),
  uninstallMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

vi.mock('@/apps/plugins/api/plugins', () => ({
  getPlugins: getPluginsMock,
  installPlugin: installMock,
  uninstallPlugin: uninstallMock,
  updatePlugin: updateMock,
}))

import { usePluginsStore } from '@/apps/plugins/stores/plugins'
import { ApiError } from '@/api/client'

beforeEach(() => {
  setActivePinia(createPinia())
  getPluginsMock.mockReset()
  installMock.mockReset()
  uninstallMock.mockReset()
  updateMock.mockReset()
})

const fixture = [
  {
    slug: 'minimax',
    name: 'MiniMax',
    description: 'Image generation',
    icon: 'puzzle',
    version: 1,
    path: '/plugins/minimax',
    bundledTools: [],
    bundledDrivers: [],
    recipePaths: [],
    migrations: { declared: 1, applied: 1, filesOnDisk: 1, pending: 0, lastAppliedAt: null, status: 'up_to_date' as const },
  },
]

describe('plugins store — load()', () => {
  it('populates plugins on success', async () => {
    getPluginsMock.mockResolvedValueOnce(fixture)
    const store = usePluginsStore()
    await store.load()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.plugins).toEqual(fixture)
  })

  it('sets error message on ApiError', async () => {
    getPluginsMock.mockRejectedValueOnce(new ApiError('Boom', 'BOOM_CODE', 500))
    const store = usePluginsStore()
    await store.load()
    expect(store.error).toBe('Boom')
    expect(store.plugins).toEqual([])
  })

  it('sets a generic error for non-ApiError rejections', async () => {
    getPluginsMock.mockRejectedValueOnce(new Error('Network'))
    const store = usePluginsStore()
    await store.load()
    expect(store.error).toBe('Failed to load plugins.')
  })

  it('clears the previous error on a fresh call', async () => {
    getPluginsMock.mockRejectedValueOnce(new Error('First failure'))
    const store = usePluginsStore()
    await store.load()
    expect(store.error).toBe('Failed to load plugins.')

    getPluginsMock.mockResolvedValueOnce([])
    await store.load()
    expect(store.error).toBeNull()
    expect(store.plugins).toEqual([])
  })
})

describe('plugins store — install()', () => {
  it('calls installPlugin and reloads the inventory', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed' })
    getPluginsMock.mockResolvedValueOnce(fixture)

    const store = usePluginsStore()
    const result = await store.install({ package: 'spora-ai/spora-plugin-tavily' })

    expect(installMock).toHaveBeenCalledWith({ package: 'spora-ai/spora-plugin-tavily' })
    expect(result.status).toBe('installed')
    expect(store.mutating).toBe(false)
    expect(store.lastResult?.package).toBe('spora-ai/spora-plugin-tavily')
    expect(store.plugins).toEqual(fixture)
  })

  it('sets the error and rethrows when installPlugin fails', async () => {
    installMock.mockRejectedValueOnce(new ApiError('Composer failed', 'PLUGIN_INSTALL_FAILED', 500))

    const store = usePluginsStore()
    await expect(store.install({ package: 'spora-ai/spora-plugin-typo' })).rejects.toBeInstanceOf(ApiError)
    expect(store.error).toBe('Composer failed')
    expect(store.mutating).toBe(false)
  })
})

describe('plugins store — uninstall()', () => {
  it('calls uninstallPlugin and reloads', async () => {
    uninstallMock.mockResolvedValueOnce({ package: 'minimax', status: 'uninstalled' })
    getPluginsMock.mockResolvedValueOnce([])

    const store = usePluginsStore()
    const result = await store.uninstall('minimax')

    expect(uninstallMock).toHaveBeenCalledWith('minimax')
    expect(result.status).toBe('uninstalled')
    expect(store.plugins).toEqual([])
  })
})

describe('plugins store — update()', () => {
  it('calls updatePlugin with the optional constraint', async () => {
    updateMock.mockResolvedValueOnce({ package: 'minimax', status: 'updated', constraint: '^0.3' })
    getPluginsMock.mockResolvedValueOnce(fixture)

    const store = usePluginsStore()
    const result = await store.update('minimax', { constraint: '^0.3' })

    expect(updateMock).toHaveBeenCalledWith('minimax', { constraint: '^0.3' })
    expect(result.status).toBe('updated')
  })

  it('passes an empty object when no constraint is supplied', async () => {
    updateMock.mockResolvedValueOnce({ package: 'minimax', status: 'updated' })
    getPluginsMock.mockResolvedValueOnce(fixture)

    const store = usePluginsStore()
    await store.update('minimax')

    expect(updateMock).toHaveBeenCalledWith('minimax', {})
  })
})