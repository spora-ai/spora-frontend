/**
 * VerifyEmailPage — handles email verification links on mount.
 *
 * Covers: signup success path, change-flow success path (with a refresh
 * of the auth store), ApiError, and a generic fallback for non-ApiError
 * rejections.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { selector: 'sel-1' }, query: { token: 'tok-1' } }),
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

  it('shows the error message on ApiError', async () => {
    const { ApiError } = await import('@/api/client')
    getMock.mockRejectedValueOnce(new ApiError('expired token'))
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
