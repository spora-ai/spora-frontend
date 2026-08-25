/**
 * router/index — verifies the route table shape and the guards' redirect logic.
 *
 * We don't navigate end-to-end because that would lazy-load every page chunk
 * during a test run; instead we mock `vue-router` to capture the route table
 * + guard function, then call the guard directly with synthetic `to` and
 * `auth.user` states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const beforeEachSpy = vi.fn()
let capturedRoutes: unknown[] = []

vi.mock('vue-router', () => ({
  createRouter: (opts: { routes: unknown[] }) => {
    capturedRoutes = opts.routes
    return { beforeEach: beforeEachSpy }
  },
  createWebHistory: vi.fn(() => ({})),
}))

const authInit = vi.fn().mockResolvedValue(undefined)
const authState = {
  initialized: true,
  user: null as { id: number } | null,
  init: authInit,
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}))

const configInit = vi.fn().mockResolvedValue(undefined)
const configState = {
  initialized: true,
  init: configInit,
}

vi.mock('@/stores/runtimeConfig', () => ({
  useRuntimeConfigStore: () => configState,
}))

const groupsFetchMock = vi.fn().mockResolvedValue(undefined)
const groupsState = {
  groups: [] as Array<unknown>,
  loading: false,
  servedUserId: null as number | null,
  markStale: vi.fn(() => {
    groupsState.groups = []
    groupsState.servedUserId = null
  }),
  fetchGroups: groupsFetchMock,
}
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => groupsState,
}))

const isRegistrationEnabledMock = vi.fn().mockResolvedValue(true)
vi.mock('@/utils/auth', () => ({
  isRegistrationEnabled: () => isRegistrationEnabledMock(),
}))

describe('router/index', () => {
  beforeEach(async () => {
    authInit.mockClear()
    configInit.mockClear()
    groupsFetchMock.mockClear()
    groupsState.markStale.mockClear()
    isRegistrationEnabledMock.mockReset().mockResolvedValue(true)
    authState.initialized = true
    authState.user = null
    configState.initialized = true
    beforeEachSpy.mockReset()
    // Re-import so the router module is freshly evaluated for each test
    vi.resetModules()
    await import('@/router/index')
  })

  it('registers a non-empty route table with named routes', () => {
    expect(capturedRoutes.length).toBeGreaterThan(0)
    const names = capturedRoutes
      .map((r) => (r as { name?: string }).name)
      .filter(Boolean)
    expect(names).toContain('login')
    expect(names).toContain('dashboard')
    expect(names).toContain('agent')
    expect(names).toContain('task')
  })

  it('configures auth-guarded routes', () => {
    const dashboard = capturedRoutes.find(
      (r) => (r as { name?: string }).name === 'dashboard',
    ) as { meta: { requiresAuth: boolean } }
    expect(dashboard.meta.requiresAuth).toBe(true)
  })

  it('configures guest-only routes', () => {
    const login = capturedRoutes.find(
      (r) => (r as { name?: string }).name === 'login',
    ) as { meta: { requiresGuest: boolean } }
    expect(login.meta.requiresGuest).toBe(true)
  })

  it('exposes a wildcard route redirecting to /', () => {
    const wildcard = capturedRoutes.find(
      (r) => (r as { path?: string }).path === '/:pathMatch(.*)*',
    ) as { redirect?: string }
    expect(wildcard.redirect).toBe('/')
  })

  it('plugin app loader accepts sub-paths under /apps/:appName', () => {
    const appsRoute = capturedRoutes.find(
      (r) => (r as { path?: string }).path === '/apps',
    ) as { children?: Array<{ path?: string; name?: string }> } | undefined
    expect(appsRoute).toBeDefined()
    const loader = (appsRoute?.children ?? []).find(
      (c) => c.name === 'plugin-app',
    ) as { path?: string } | undefined
    expect(loader).toBeDefined()
    expect(loader?.path).toBe(':appName/:rest*')
  })

  it('register beforeEnter redirects to login when registration is disabled', async () => {
    isRegistrationEnabledMock.mockResolvedValueOnce(false)
    const register = capturedRoutes.find(
      (r) => (r as { name?: string }).name === 'register',
    ) as { beforeEnter: () => Promise<unknown> }
    const result = await register.beforeEnter()
    expect(result).toEqual({ name: 'login' })
  })

  it('register beforeEnter passes through when registration is enabled', async () => {
    isRegistrationEnabledMock.mockResolvedValueOnce(true)
    const register = capturedRoutes.find(
      (r) => (r as { name?: string }).name === 'register',
    ) as { beforeEnter: () => Promise<unknown> }
    const result = await register.beforeEnter()
    expect(result).toBeUndefined()
  })

  describe('global beforeEach guard', () => {
    function getGuard() {
      // beforeEach() was invoked once during module init
      return beforeEachSpy.mock.calls[0][0] as (
        to: { meta: Record<string, unknown> },
      ) => Promise<unknown>
    }

    it('calls auth.init() when not initialized', async () => {
      authState.initialized = false
      const guard = getGuard()
      await guard({ meta: {} })
      expect(authInit).toHaveBeenCalledTimes(1)
    })

    it('calls config.init() when not initialized', async () => {
      configState.initialized = false
      const guard = getGuard()
      await guard({ meta: {} })
      expect(configInit).toHaveBeenCalledTimes(1)
    })

    it('pre-fetches groups for an authenticated caller with empty cache', async () => {
      authState.user = { id: 1 }
      groupsState.groups = []
      groupsState.loading = false
      const guard = getGuard()
      await guard({ meta: {} })
      expect(groupsFetchMock).toHaveBeenCalledTimes(1)
    })

    it('marks the groups cache stale when the auth user id drifts', async () => {
      // Simulate the bug scenario: the admin already populated the cache.
      // servedUserId is the admin's id (1), the cache contains groups.
      authState.user = { id: 1 }
      groupsState.servedUserId = 1
      groupsState.groups = [{ id: 1, name: 'AdminGroup', principal_id: 5 }]
      groupsFetchMock.mockClear()
      groupsState.markStale.mockClear()
      const guard = getGuard()

      // Second navigation as user 2 — the cache should be invalidated so
      // the next groups.list() re-fetches under the new session.
      authState.user = { id: 2 }
      await guard({ meta: {} })
      expect(groupsState.markStale).toHaveBeenCalledTimes(1)
    })

    it('marks the groups cache stale when the user signs out', async () => {
      authState.user = { id: 1 }
      groupsState.servedUserId = 1
      groupsState.markStale.mockClear()
      const guard = getGuard()
      authState.user = null
      await guard({ meta: {} })
      expect(groupsState.markStale).toHaveBeenCalled()
    })

    it('does not mark the groups cache stale when the auth user id matches', async () => {
      authState.user = { id: 5 }
      groupsState.servedUserId = 5
      groupsState.markStale.mockClear()
      const guard = getGuard()
      await guard({ meta: {} })
      expect(groupsState.markStale).not.toHaveBeenCalled()
    })

    it('skips the groups pre-fetch when the caller is unauthenticated', async () => {
      authState.user = null
      groupsState.groups = []
      const guard = getGuard()
      await guard({ meta: {} })
      expect(groupsFetchMock).not.toHaveBeenCalled()
    })

    it('skips the groups pre-fetch when the cache is already populated', async () => {
      authState.user = { id: 1 }
      groupsState.groups = [{ id: 1, name: 'Existing', principal_id: 5 }]
      const guard = getGuard()
      await guard({ meta: {} })
      expect(groupsFetchMock).not.toHaveBeenCalled()
    })

    it('skips the groups pre-fetch when one is already in flight', async () => {
      authState.user = { id: 1 }
      groupsState.groups = []
      groupsState.loading = true
      const guard = getGuard()
      await guard({ meta: {} })
      expect(groupsFetchMock).not.toHaveBeenCalled()
    })

    it('redirects unauthenticated users from auth-required routes', async () => {
      authState.user = null
      const guard = getGuard()
      const result = await guard({ meta: { requiresAuth: true } })
      expect(result).toEqual({ name: 'login' })
    })

    it('allows authenticated users through auth-required routes', async () => {
      authState.user = { id: 1 }
      const guard = getGuard()
      const result = await guard({ meta: { requiresAuth: true } })
      expect(result).toBeUndefined()
    })

    it('redirects authenticated users away from guest-only routes', async () => {
      authState.user = { id: 1 }
      const guard = getGuard()
      const result = await guard({ meta: { requiresGuest: true } })
      expect(result).toEqual({ name: 'dashboard' })
    })

    it('allows unauthenticated users to access guest-only routes', async () => {
      authState.user = null
      const guard = getGuard()
      const result = await guard({ meta: { requiresGuest: true } })
      expect(result).toBeUndefined()
    })

    it('allows everyone through routes with no meta guards', async () => {
      authState.user = null
      const guard = getGuard()
      const result = await guard({ meta: {} })
      expect(result).toBeUndefined()
    })
  })
})
