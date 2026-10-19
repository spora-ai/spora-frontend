/**
 * useLocaleStore — the resolution chain, the persisted boot cache, and the
 * `<html lang>` attribute.
 *
 * The chain is `users.locale` → `default_lang` → `en`. Every case below is
 * one link either answering or failing, because each link is a separate
 * source that can be absent independently of the others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
    }
  },
}))

import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useLocaleStore } from '@/stores/locale'
import { i18n, PERSISTED_LOCALE_KEY } from '@/i18n'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

/**
 * A session. The preference link is only reachable when `auth.user` is set,
 * and `init()` awaits `auth.init()` to find that out — so most cases have to
 * answer `/auth/me` too or the store correctly skips straight past them.
 */
const SIGNED_IN = { '/auth/me': { user: { id: 1, name: 'Ada' } } }
const GUEST = { '/auth/me': new Error('unauthenticated') }

/** Answer the config, preference and session endpoints by path. */
function routeApi(routes: Record<string, unknown>) {
  mockApi.get.mockImplementation((path: string) => {
    if (!(path in routes)) return Promise.reject(new Error(`unrouted: ${path}`))
    const value = routes[path]
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  })
}

describe('useLocaleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
    localStorage.clear()
    document.documentElement.lang = 'en'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prefers the user's own preference over the instance default", async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })

    const store = useLocaleStore()
    await store.init()

    expect(store.locale).toBe('de')
    expect(store.source).toBe('preference')
    expect(i18n.global.locale.value).toBe('de')
  })

  it('falls back to the instance default when the user has no preference', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: null },
      '/config': { default_lang: 'de' },
    })

    const store = useLocaleStore()
    await store.init()

    expect(store.locale).toBe('de')
    expect(store.source).toBe('instance')
  })

  it('falls back to en when the instance names no language', async () => {
    routeApi({ ...GUEST, '/user-preferences/locale': { locale: null }, '/config': {} })

    const store = useLocaleStore()
    await store.init()

    expect(store.locale).toBe('en')
  })

  it('falls back to en when the instance names a language this build does not ship', async () => {
    // `/config` answers `default_lang: 'fr'` on a server whose operators
    // picked a language the frontend has not shipped. Falling back to `en`
    // is the only option that renders text rather than raw keys.
    routeApi({
      ...GUEST,
      '/user-preferences/locale': { locale: null },
      '/config': { default_lang: 'fr' },
    })

    const store = useLocaleStore()
    await store.init()

    expect(store.locale).toBe('en')
    expect(store.source).toBe('fallback')
  })

  it('ignores a preference the frontend ships no catalogue for', async () => {
    // A plugin can register a language the frontend has not caught up with.
    // Taking it verbatim would leave every component rendering raw keys.
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'fr' },
      '/config': { default_lang: 'de' },
    })

    const store = useLocaleStore()
    await store.init()

    expect(store.locale).toBe('de')
    expect(store.source).toBe('instance')
  })

  it('does not ask for a preference from a guest', async () => {
    routeApi({ ...GUEST, '/config': { default_lang: 'de' } })

    const store = useLocaleStore()
    await store.init()

    expect(mockApi.get).not.toHaveBeenCalledWith('/user-preferences/locale')
    expect(store.locale).toBe('de')
  })

  it('drives <html lang>, not just the composer locale', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })

    await useLocaleStore().init()

    expect(document.documentElement.lang).toBe('de')
  })

  it('persists the resolved locale so the next boot does not flash', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })

    await useLocaleStore().init()

    expect(localStorage.getItem(PERSISTED_LOCALE_KEY)).toBe('de')
  })

  it('lets the cached locale win the first paint but not the final answer', async () => {
    // This is the whole point of persisting. A cached `de` must not outrank
    // an instance that has since switched its default to `en`, so the cache
    // is only ever the starting value.
    localStorage.setItem(PERSISTED_LOCALE_KEY, 'de')
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: null },
      '/config': { default_lang: 'en' },
    })

    const store = useLocaleStore()
    // Before init resolves the cached value is what renders.
    expect(store.locale).toBe('de')
    expect(store.source).toBe('cache')
    expect(document.documentElement.lang).not.toBe('de')

    await store.init()
    expect(store.locale).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('starts at en when the cache holds a locale this build does not ship', async () => {
    localStorage.setItem(PERSISTED_LOCALE_KEY, 'klingon')
    routeApi({ ...GUEST, '/config': { default_lang: 'en' } })

    const store = useLocaleStore()
    expect(store.locale).toBe('en')
    await store.init()
    expect(store.locale).toBe('en')
  })

  it('exposes t() outside a component setup scope', () => {
    // Delegated handlers like `src/copyCode.ts` have no instance to inject
    // into, so the store is the only way they can translate.
    const store = useLocaleStore()
    expect(store.t('Pending')).toBe('Pending')
  })

  it('setLocale moves the whole surface at once and ignores unknown locales', async () => {
    routeApi({
      ...GUEST,
      '/user-preferences/locale': { locale: null },
      '/config': { default_lang: 'en' },
    })
    const store = useLocaleStore()
    await store.init()

    store.setLocale('de')
    expect(store.locale).toBe('de')
    expect(i18n.global.locale.value).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(localStorage.getItem(PERSISTED_LOCALE_KEY)).toBe('de')

    store.setLocale('fr')
    expect(store.locale).toBe('de')
  })

  it('dedupes concurrent init() calls', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })

    const store = useLocaleStore()
    await Promise.all([store.init(), store.init()])

    expect(mockApi.get.mock.calls.filter(([p]) => p === '/user-preferences/locale')).toHaveLength(1)
  })

  it('seeds auth and runtime config so the chain has an answer to read', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en', allow_registration: true },
    })

    await useLocaleStore().init()

    // `init()` awaits `auth.init()` — without that, `auth.user` is still
    // null for every caller and the preference link is never taken.
    expect(useAuthStore().initialized).toBe(true)
    expect(useRuntimeConfigStore().initialized).toBe(true)
  })
})