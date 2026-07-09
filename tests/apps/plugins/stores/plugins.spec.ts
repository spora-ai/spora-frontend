/**
 * plugins store — load() + install/uninstall/update actions.
 *
 * Mutations are pure: the store no longer reloads the inventory after a
 * successful install / uninstall / update. Callers (the page-level modal
 * handler, the InstallPluginModal `@installed` event) are responsible for
 * calling `store.load()` themselves. The regression tests below prove that
 * no implicit reload happens — a failing reload inside `install()` was the
 * mechanism that painted "Install failed." on the Installed tab even when
 * the install itself succeeded.
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
    package: 'spora-ai/spora-plugin-minimax',
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
  it('calls installPlugin with the payload and returns the result', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed' })

    const store = usePluginsStore()
    const result = await store.install({ package: 'spora-ai/spora-plugin-tavily' })

    expect(installMock).toHaveBeenCalledWith({ package: 'spora-ai/spora-plugin-tavily' })
    expect(result.status).toBe('installed')
    expect(store.mutating).toBe(false)
    expect(store.lastResult?.package).toBe('spora-ai/spora-plugin-tavily')
  })

  // Regression for Bug 1 — a failed post-install load() used to poison
  // `error` with the load failure, which the page rendered as "Install
  // failed." even when the install itself succeeded. The store must not
  // call load() at all on the success path.
  it('does NOT reload the inventory after a successful install', async () => {
    installMock.mockResolvedValueOnce({ package: 'spora-ai/spora-plugin-tavily', status: 'installed' })

    const store = usePluginsStore()
    await store.install({ package: 'spora-ai/spora-plugin-tavily' })

    expect(getPluginsMock).not.toHaveBeenCalled()
  })

  it('sets the error and rethrows when installPlugin fails', async () => {
    installMock.mockRejectedValueOnce(new ApiError('Composer failed', 'PLUGIN_INSTALL_FAILED', 500))

    const store = usePluginsStore()
    await expect(store.install({ package: 'spora-ai/spora-plugin-typo' })).rejects.toBeInstanceOf(ApiError)
    expect(store.error).toBe('Composer failed')
    expect(store.mutating).toBe(false)
  })

  it('falls back to the literal "Install failed." for non-ApiError rejections', async () => {
    installMock.mockRejectedValueOnce(new Error('Network'))

    const store = usePluginsStore()
    await expect(store.install({ package: 'spora-ai/spora-plugin-x' })).rejects.toThrow()
    expect(store.error).toBe('Install failed.')
  })

  it('does NOT reload the inventory after a failed install', async () => {
    installMock.mockRejectedValueOnce(new ApiError('Boom', 'BOOM', 500))

    const store = usePluginsStore()
    await store.install({ package: 'spora-ai/spora-plugin-x' }).catch(() => undefined)

    expect(getPluginsMock).not.toHaveBeenCalled()
  })
})

describe('plugins store — uninstall()', () => {
  it('calls uninstallPlugin and returns the result without reloading', async () => {
    uninstallMock.mockResolvedValueOnce({ package: 'minimax', status: 'uninstalled' })

    const store = usePluginsStore()
    const result = await store.uninstall('minimax')

    expect(uninstallMock).toHaveBeenCalledWith('minimax')
    expect(result.status).toBe('uninstalled')
    expect(store.lastResult?.package).toBe('minimax')
    expect(getPluginsMock).not.toHaveBeenCalled()
  })

  it('sets the error and rethrows when uninstallPlugin fails', async () => {
    uninstallMock.mockRejectedValueOnce(new ApiError('Composer failed', 'PLUGIN_UNINSTALL_FAILED', 500))

    const store = usePluginsStore()
    await expect(store.uninstall('minimax')).rejects.toBeInstanceOf(ApiError)
    expect(store.error).toBe('Composer failed')
    expect(store.mutating).toBe(false)
    expect(getPluginsMock).not.toHaveBeenCalled()
  })
})

describe('plugins store — update()', () => {
  it('calls updatePlugin with the optional constraint', async () => {
    updateMock.mockResolvedValueOnce({ package: 'minimax', status: 'updated', constraint: '^0.3' })

    const store = usePluginsStore()
    const result = await store.update('minimax', { constraint: '^0.3' })

    expect(updateMock).toHaveBeenCalledWith('minimax', { constraint: '^0.3' })
    expect(result.status).toBe('updated')
    expect(getPluginsMock).not.toHaveBeenCalled()
  })

  it('passes an empty object when no constraint is supplied', async () => {
    updateMock.mockResolvedValueOnce({ package: 'minimax', status: 'updated' })

    const store = usePluginsStore()
    await store.update('minimax')

    expect(updateMock).toHaveBeenCalledWith('minimax', {})
    expect(getPluginsMock).not.toHaveBeenCalled()
  })

  it('sets the error and rethrows when updatePlugin fails', async () => {
    updateMock.mockRejectedValueOnce(new ApiError('Composer failed', 'PLUGIN_UPDATE_FAILED', 500))

    const store = usePluginsStore()
    await expect(store.update('minimax', { constraint: '^0.3' })).rejects.toBeInstanceOf(ApiError)
    expect(store.error).toBe('Composer failed')
    expect(store.mutating).toBe(false)
  })
})
