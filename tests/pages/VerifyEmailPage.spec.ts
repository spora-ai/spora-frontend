/**
 * VerifyEmailPage — handles email verification links on mount.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
const routeState = {
  params: { selector: 'sel-1' } as Record<string, string>,
  query: { token: 'tok-1' } as Record<string, string>,
}
vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public code = '', public status = 0) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { api } from '@/api/client'
import VerifyEmailPage from '@/pages/VerifyEmailPage.vue'

const getMock = api.get as ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
})

describe('VerifyEmailPage', () => {
  it('renders the signup success state on a kind=signup response', async () => {
    getMock.mockResolvedValueOnce({
      kind: 'signup',
      old_email: null,
      new_email: 'fresh@example.com',
      message: 'Email verified successfully.',
    })

    const wrapper = mount(VerifyEmailPage)
    await flushPromises()

    expect(getMock).toHaveBeenCalledWith('/auth/verify/sel-1?token=tok-1')
    expect(wrapper.text()).toMatch(/verified/i)
    expect(wrapper.text()).toMatch(/sign in/i)
    expect(wrapper.text()).toContain('fresh@example.com')
  })

  it('renders the email-change success state on a kind=change response and refreshes the auth store', async () => {
    getMock
      .mockResolvedValueOnce({
        kind: 'change',
        old_email: 'old@example.com',
        new_email: 'new@example.com',
        message: 'Email address changed successfully.',
      })
      .mockResolvedValueOnce({
        user: { id: 1, email: 'new@example.com' },
        csrf_token: 'tok-r',
      })

    const wrapper = mount(VerifyEmailPage)
    await flushPromises()

    expect(wrapper.text()).toMatch(/updated/i)
    expect(wrapper.text()).toContain('new@example.com')
    expect(getMock).toHaveBeenCalledTimes(2)
    expect(getMock).toHaveBeenNthCalledWith(2, '/auth/me')
  })

  it('does not refetch /auth/me on kind=signup', async () => {
    getMock.mockResolvedValueOnce({
      kind: 'signup',
      old_email: null,
      new_email: 'fresh@example.com',
      message: 'Email verified successfully.',
    })

    mount(VerifyEmailPage)
    await flushPromises()

    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a link that carries no token', async () => {
    // A truncated link must say so rather than firing a request that
    // can only fail.
    routeState.query = {}
    const wrapper = mount(VerifyEmailPage)
    await flushPromises()

    expect(getMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Invalid verification link. Please check your email and try again.')
    routeState.query = { token: 'tok-1' }
  })

  it('shows the error message on ApiError', async () => {
    const { ApiError } = await import('@/api/client')
    getMock.mockRejectedValueOnce(new ApiError('expired token', 'UNKNOWN', 400))
    const wrapper = mount(VerifyEmailPage)
    await flushPromises()
    expect(wrapper.text()).toContain('expired token')
  })

  it('uses a generic fallback for non-ApiError rejections', async () => {
    getMock.mockRejectedValueOnce(new Error('network'))
    const wrapper = mount(VerifyEmailPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Verification failed')
  })
})
