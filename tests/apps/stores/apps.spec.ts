import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { api, ApiError } from '@/api/client'
import { useAppsStore } from '@/apps/stores/apps'
import type { AppResource } from '@/apps/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { api: mod.api, ApiError: mod.ApiError }
})

const makeApp = (overrides: Partial<AppResource> = {}): AppResource => ({
  name: 'media-archive',
  displayName: 'Media Archive',
  description: 'Browse media',
  icon: 'image',
  route: '/apps/media-archive',
  ...overrides,
})

describe('useAppsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts empty with no error', () => {
    const store = useAppsStore()
    expect(store.apps).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.mountableApps).toEqual([])
  })

  it('loads apps from /apps endpoint', async () => {
    const fixture: AppResource[] = [
      makeApp({ name: 'media-archive', slug: 'media-archive', frontendEntry: 'main.js' }),
      makeApp({ name: 'settings', route: '/settings' }),
    ]
    vi.spyOn(api, 'get').mockResolvedValueOnce({ apps: fixture })

    const store = useAppsStore()
    await store.load()

    expect(store.apps).toEqual(fixture)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.mountableApps).toHaveLength(1)
    expect(store.mountableApps[0]?.name).toBe('media-archive')
  })

  it('caches the load promise so concurrent callers share a single request', async () => {
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      calls += 1
      return { apps: [makeApp()] }
    })

    const store = useAppsStore()
    await Promise.all([store.load(), store.load(), store.load()])
    expect(calls).toBe(1)
  })

  it('force=true re-fetches even when a prior load succeeded', async () => {
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      calls += 1
      return { apps: [makeApp({ name: `app-${calls}` })] }
    })

    const store = useAppsStore()
    await store.load()
    expect(store.apps[0]?.name).toBe('app-1')

    await store.load(true)
    expect(calls).toBe(2)
    expect(store.apps[0]?.name).toBe('app-2')
  })

  it('clears the cache on failure so the next load retries', async () => {
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      calls += 1
      throw new ApiError('boom', 500, 'boom')
    })

    const store = useAppsStore()
    await store.load()
    expect(store.error).toBe('boom')
    expect(store.apps).toEqual([])

    await store.load()
    expect(calls).toBe(2)
  })

  it('falls back to a generic error message for non-ApiError exceptions', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('network down'))

    const store = useAppsStore()
    await store.load()
    expect(store.error).toBe('Failed to load apps.')
    expect(store.apps).toEqual([])
  })

  it('resolveApp returns the matching app or null', async () => {
    const fixture: AppResource[] = [
      makeApp({ name: 'a' }),
      makeApp({ name: 'b' }),
    ]
    vi.spyOn(api, 'get').mockResolvedValueOnce({ apps: fixture })
    const store = useAppsStore()
    await store.load()

    expect(store.resolveApp('a')?.name).toBe('a')
    expect(store.resolveApp('b')?.name).toBe('b')
    expect(store.resolveApp('missing')).toBeNull()
  })

  it('mountableApps filters apps without frontendEntry and slug', async () => {
    const fixture: AppResource[] = [
      makeApp({ name: 'core-settings', route: '/settings' }),                                     // no slug/entry
      makeApp({ name: 'core-plugins' }),                                      // no slug/entry
      makeApp({ name: 'media-archive', slug: 'media-archive', frontendEntry: 'main.js' }),
      makeApp({ name: 'half', slug: 'half' }),                                 // missing frontendEntry
      makeApp({ name: 'half2', frontendEntry: 'main.js' }),                    // missing slug
    ]
    vi.spyOn(api, 'get').mockResolvedValueOnce({ apps: fixture })
    const store = useAppsStore()
    await store.load()

    expect(store.mountableApps.map(a => a.name)).toEqual(['media-archive'])
  })
})