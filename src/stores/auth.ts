import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, ApiError } from '@/api/client'
import { log } from '@/utils/logger'
import type { AuthVerifyResponse } from '@/types/auth'
import type { User } from '@/types/user'

export { type User }
export { type AuthVerifyResponse } from '@/types/auth'

/**
 * Manages authentication: session init, login, logout, registration,
 * password/email changes, and CSRF token handling.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const csrfToken = ref<string | null>(null)
  const initialized = ref(false)
  const initError = ref<Error | null>(null)

  function normalizeUser(raw: User | null): User | null {
    if (raw === null) return null
    const roles: string[] = raw.roles ? [...raw.roles] : []
    if (raw.is_admin && !roles.includes('ADMIN')) roles.push('ADMIN')
    return { ...raw, roles }
  }

  let initPromise: Promise<void> | null = null

  interface MeResponse {
    user: User
    csrf_token?: string
  }

  /**
   * Pull the current session from `GET /auth/me`. Throws on any non-2xx —
   * callers are responsible for either surfacing the failure (refresh) or
   * tolerating it (verifyEmail, where a hiccup must not log the user out
   * after their email change has already been confirmed server-side).
   */
  async function fetchMe(): Promise<MeResponse> {
    return api.get<MeResponse>('/auth/me')
  }

  /**
   * Pull the current session from `GET /auth/me` and update the local
   * store. Safe to call at any time — does not dedupe. On 401 the user is
   * cleared silently; any other failure surfaces as `initError`.
   */
  async function refresh(): Promise<void> {
    initError.value = null
    try {
      const res = await fetchMe()
      user.value = normalizeUser(res.user)
      csrfToken.value = res.csrf_token ?? null
    } catch (e) {
      user.value = null
      csrfToken.value = null
      const isUnauthenticated = e instanceof ApiError && e.status === 401
      if (!isUnauthenticated) {
        initError.value = e instanceof Error ? e : new Error(String(e))
      }
    } finally {
      initialized.value = true
    }
  }

  /** Called once on app boot to restore session from the server cookie. */
  function init(): Promise<void> {
    if (initPromise !== null) return initPromise

    initPromise = (async () => {
      await refresh()
      if (initError.value !== null) {
        initPromise = null
      }
    })()

    return initPromise
  }

  async function login(email: string, password: string): Promise<void> {
    const res = (await api.post<MeResponse>('/auth/login', { email, password }))
    user.value = normalizeUser(res.user)
    csrfToken.value = res.csrf_token ?? null
    initialized.value = true
  }

  /**
   * Register a new user account.
   * Does NOT log the user in — caller must handle the "verify email" state.
   */
  async function register(email: string, password: string, confirmPassword: string, displayName: string): Promise<{ id: number; email: string }> {
    const res = await api.post<{ user: { id: number; email: string } }>('/auth/register', { email, password, confirm_password: confirmPassword, display_name: displayName })
    return { id: res.user.id, email: res.user.email }
  }

  async function logout(): Promise<void> {
    // Post first so the X-CSRF-Token header can still be injected from the store.
    // Failures here are fine — the server may already consider the session gone;
    // we clear local state regardless.
    await api.post('/auth/logout').catch((e) => {
      log.warn('[auth] logout request failed; clearing local session anyway', e)
    })
    user.value = null
    csrfToken.value = null
    initPromise = null
    initialized.value = false
  }

  async function changePassword(current: string, next: string): Promise<void> {
    await api.patch('/auth/password', { current_password: current, new_password: next })
  }

  async function updateAccount(name: string): Promise<void> {
    const updated = await api.patch<{ user: User }>('/auth/account', { name })
    user.value = normalizeUser(updated.user)
  }

  async function resendVerification(email: string): Promise<void> {
    await api.post('/auth/verification/resend', { email })
  }

  async function forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email })
  }

  async function resetPassword(selector: string, token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { selector, token, password })
  }

  async function changeEmail(newEmail: string): Promise<void> {
    await api.post('/auth/email/change-request', { email: newEmail })
  }

  /**
   * Verify an email link from `GET /api/v1/auth/verify/{selector}`. The
   * backend distinguishes the initial signup (`kind: 'signup'`) from an
   * address change (`kind: 'change'`); on change, the local user record
   * is refreshed so the navbar / `auth.user.email` reflects the new
   * address without a full reload.
   *
   * On `change`, uses the slimmer `fetchMe()` rather than `refresh()` so a
   * transient `/auth/me` failure does not clear the session — the email
   * change is already committed server-side at this point, so a network
   * hiccup must not log the user out of the SPA.
   */
  async function verifyEmail(selector: string, token: string): Promise<AuthVerifyResponse> {
    const res = await api.get<AuthVerifyResponse>(
      `/auth/verify/${encodeURIComponent(selector)}?token=${encodeURIComponent(token)}`,
    )
    if (res.kind === 'change') {
      try {
        const me = await fetchMe()
        user.value = normalizeUser(me.user)
        csrfToken.value = me.csrf_token ?? null
      } catch (e) {
        log.warn('[auth] verifyEmail: /auth/me refresh failed; address still updated server-side', e)
      }
    }
    return res
  }

  return {
    user,
    csrfToken,
    initialized,
    initError,
    init,
    refresh,
    login,
    register,
    logout,
    changePassword,
    updateAccount,
    resendVerification,
    forgotPassword,
    resetPassword,
    changeEmail,
    verifyEmail,
  }
})
