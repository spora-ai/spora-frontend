import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the api module
vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public readonly code: string, message: string, public readonly status: number) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { api } from '@/api/client'

const mockApi = api as ReturnType<typeof vi.fn>

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  describe('init', () => {
    it('sets user from /auth/me on success', async () => {
      mockApi.get.mockResolvedValueOnce({ user: { id: 1, email: 'test@example.com' } })

      const store = useAuthStore()
      const promise = store.init()
      await promise

      expect(store.user).toEqual({ id: 1, email: 'test@example.com', roles: [] })
      expect(store.initialized).toBe(true)
    })

    it('sets user to null on 401 error', async () => {
      const { ApiError } = await import('@/api/client')
      mockApi.get.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 'Not logged in', 401))

      const store = useAuthStore()
      await store.init()

      expect(store.user).toBe(null)
      expect(store.initialized).toBe(true)
    })

    it('deduplicates concurrent init calls by calling API only once', async () => {
      let resolve: (v: unknown) => void
      const pendingPromise = new Promise((r) => { resolve = r })
      mockApi.get.mockReturnValue(pendingPromise as any)

      const store = useAuthStore()

      store.init()
      store.init()

      expect(mockApi.get).toHaveBeenCalledTimes(1)

      resolve!({ user: { id: 1, email: 'a@b.com' } })
      await pendingPromise

      expect(store.user).toEqual({ id: 1, email: 'a@b.com', roles: [] })
      expect(store.initialized).toBe(true)
    })
  })

  describe('login', () => {
    it('sets user on success', async () => {
      mockApi.post.mockResolvedValueOnce({ user: { id: 1, email: 'test@example.com' } })

      const store = useAuthStore()
      await store.login('test@example.com', 'password')

      expect(mockApi.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password',
      })
      expect(store.user).toEqual({ id: 1, email: 'test@example.com', roles: [] })
    })
  })

  describe('logout', () => {
    it('clears user state optimistically', async () => {
      const store = useAuthStore()
      store.user = { id: 1, email: 'test@example.com' }
      store.initialized = true

      mockApi.post.mockResolvedValueOnce(undefined)

      await store.logout()

      expect(store.user).toBe(null)
      expect(store.initialized).toBe(false)
      expect(mockApi.post).toHaveBeenCalledTimes(1)
      expect(mockApi.post.mock.calls[0][0]).toBe('/auth/logout')
    })

    it('keeps user and csrfToken in store while the API call is in flight, then clears them', async () => {
      // Regression: token is read by injectCsrfIfNeeded at request time.
      const store = useAuthStore()
      store.user = { id: 1, email: 'test@example.com' }
      store.csrfToken = 'live-csrf-token'
      store.initialized = true

      let capturedUser: unknown
      let capturedCsrf: unknown
      mockApi.post.mockImplementationOnce(async () => {
        // Snapshot the store at the moment the request fires.
        capturedUser = store.user
        capturedCsrf = store.csrfToken
        return undefined
      })

      await store.logout()

      expect(mockApi.post).toHaveBeenCalledTimes(1)
      expect(mockApi.post.mock.calls[0][0]).toBe('/auth/logout')
      // Token + user must still be present so the API client can attach the header.
      expect(capturedUser).toEqual({ id: 1, email: 'test@example.com' })
      expect(capturedCsrf).toBe('live-csrf-token')
      // ...and cleared afterwards.
      expect(store.user).toBe(null)
      expect(store.csrfToken).toBe(null)
      expect(store.initialized).toBe(false)
    })

    it('clears user state even if the API call rejects', async () => {
      const store = useAuthStore()
      store.user = { id: 1, email: 'test@example.com' }
      store.csrfToken = 'live-csrf-token'
      store.initialized = true

      mockApi.post.mockRejectedValueOnce(new Error('network down'))

      await store.logout()

      expect(store.user).toBe(null)
      expect(store.csrfToken).toBe(null)
      expect(store.initialized).toBe(false)
    })
  })

  describe('register', () => {
    it('calls POST /auth/register and returns user info without setting user (pending verification)', async () => {
      const mockUser = { id: 2, email: 'new@example.com' }
      mockApi.post.mockResolvedValueOnce({ user: { id: 2, email: 'new@example.com' } })

      const store = useAuthStore()
      const result = await store.register('new@example.com', 'password123', 'password123', 'New User')

      expect(mockApi.post).toHaveBeenCalledWith('/auth/register', {
        email: 'new@example.com',
        password: 'password123',
        confirm_password: 'password123',
        display_name: 'New User'
      })
      expect(result).toEqual(mockUser)
      expect(store.user).toBeNull() // User is NOT logged in — must verify email first
    })
  })

  describe('resendVerification', () => {
    it('calls POST /auth/verification/resend with email', async () => {
      mockApi.post.mockResolvedValueOnce(undefined)

      const store = useAuthStore()
      await store.resendVerification('new@example.com')

      expect(mockApi.post).toHaveBeenCalledWith('/auth/verification/resend', {
        email: 'new@example.com',
      })
    })
  })

  describe('forgotPassword', () => {
    it('calls POST /auth/forgot-password with email', async () => {
      mockApi.post.mockResolvedValueOnce(undefined)

      const store = useAuthStore()
      await store.forgotPassword('test@example.com')

      expect(mockApi.post).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'test@example.com',
      })
    })
  })

  describe('changeEmail', () => {
    it('calls POST /auth/email/change-request with email', async () => {
      mockApi.post.mockResolvedValueOnce(undefined)

      const store = useAuthStore()
      await store.changeEmail('newemail@example.com')

      expect(mockApi.post).toHaveBeenCalledWith('/auth/email/change-request', {
        email: 'newemail@example.com',
      })
    })
  })

  describe('refresh', () => {
    it('pulls the current session from /auth/me and updates the user', async () => {
      mockApi.get.mockResolvedValueOnce({
        user: { id: 7, email: 'fresh@example.com', name: 'Fresh' },
        csrf_token: 'tok-3',
      })

      const store = useAuthStore()
      await store.refresh()

      expect(mockApi.get).toHaveBeenCalledWith('/auth/me')
      expect(store.user).toEqual({ id: 7, email: 'fresh@example.com', name: 'Fresh', roles: [] })
      expect(store.csrfToken).toBe('tok-3')
      expect(store.initialized).toBe(true)
    })

    it('clears the user on 401', async () => {
      const { ApiError } = await import('@/api/client')
      mockApi.get.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED', 'Not logged in', 401))

      const store = useAuthStore()
      await store.refresh()

      expect(store.user).toBe(null)
      expect(store.csrfToken).toBe(null)
      expect(store.initialized).toBe(true)
    })
  })

  describe('verifyEmail', () => {
    it('returns the typed response from GET /auth/verify/:selector?token=...', async () => {
      const response = {
        kind: 'signup',
        old_email: null,
        new_email: 'fresh@example.com',
        message: 'Email verified successfully.',
      }
      mockApi.get.mockResolvedValueOnce(response)

      const store = useAuthStore()
      const result = await store.verifyEmail('sel-1', 'tok-1')

      expect(mockApi.get).toHaveBeenCalledWith('/auth/verify/sel-1?token=tok-1')
      expect(result).toEqual(response)
    })

    it('re-fetches /auth/me on kind=change so the local user record is in sync', async () => {
      mockApi.get
        .mockResolvedValueOnce({
          kind: 'change',
          old_email: 'old@example.com',
          new_email: 'new@example.com',
          message: 'Email address changed successfully.',
        })
        .mockResolvedValueOnce({
          user: { id: 1, email: 'new@example.com', name: 'X' },
          csrf_token: 'tok-r',
        })

      const store = useAuthStore()
      const result = await store.verifyEmail('sel-2', 'tok-2')

      expect(result.kind).toBe('change')
      expect(mockApi.get).toHaveBeenCalledTimes(2)
      expect(mockApi.get).toHaveBeenNthCalledWith(2, '/auth/me')
      expect(store.user?.email).toBe('new@example.com')
    })

    it('does not re-fetch /auth/me on kind=signup', async () => {
      mockApi.get.mockResolvedValueOnce({
        kind: 'signup',
        old_email: null,
        new_email: 'fresh@example.com',
        message: 'Email verified successfully.',
      })

      const store = useAuthStore()
      await store.verifyEmail('sel-3', 'tok-3')

      expect(mockApi.get).toHaveBeenCalledTimes(1)
    })
  })

  describe('changePassword', () => {
    it('calls PATCH /auth/password with correct body', async () => {
      mockApi.patch.mockResolvedValueOnce({ message: 'Password updated' })

      const store = useAuthStore()
      await store.changePassword('oldPass123', 'newPass456')

      expect(mockApi.patch).toHaveBeenCalledWith('/auth/password', {
        current_password: 'oldPass123',
        new_password: 'newPass456',
      })
    })
  })

  describe('updateAccount', () => {
    it('calls PATCH /auth/account and updates user', async () => {
      mockApi.patch.mockResolvedValueOnce({
        user: { id: 1, email: 'test@example.com', name: 'newname' },
      })

      const store = useAuthStore()
      await store.updateAccount('newname')

      expect(mockApi.patch).toHaveBeenCalledWith('/auth/account', { name: 'newname' })
      expect(store.user).toEqual({ id: 1, email: 'test@example.com', name: 'newname', roles: [] })
    })
  })
})
