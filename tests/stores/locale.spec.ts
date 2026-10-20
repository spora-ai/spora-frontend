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
  api: { get: vi.fn(), put: vi.fn() },
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

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

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
    mockApi.put.mockReset()
    mockApi.put.mockResolvedValue({ locale: null })
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

  it('falls back to the instance default when the preference lookup fails', async () => {
    // The preference read is guarded: a failing lookup must not stop the
    // boot, it just means the instance default wins.
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': new Error('preference service is down'),
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

  it('setLocale moves the whole surface at once and ignores unknown locales', async () => {
    routeApi({
      ...GUEST,
      '/user-preferences/locale': { locale: null },
      '/config': { default_lang: 'en' },
    })
    const store = useLocaleStore()
    await store.init()

    await store.setLocale('de')
    expect(store.locale).toBe('de')
    expect(i18n.global.locale.value).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(localStorage.getItem(PERSISTED_LOCALE_KEY)).toBe('de')

    await store.setLocale('fr')
    expect(store.locale).toBe('de')
  })

  it('writes the chosen locale to the server', async () => {
    // A choice that is only applied locally is undone by the next boot:
    // `init()` resolves the stored preference, the instance default, and
    // only then `en` — so nothing the operator picked would survive.
    routeApi({ ...GUEST, '/config': { default_lang: 'en' } })
    const store = useLocaleStore()
    await store.init()

    const saved = await store.setLocale('de')

    expect(saved).toBe(true)
    expect(mockApi.put).toHaveBeenCalledWith('/user-preferences/locale', { locale: 'de' })
    expect(store.preference).toBe('de')
  })

  it('reports a refused save and puts the confirmed language back', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })
    const store = useLocaleStore()
    await store.init()
    expect(store.locale).toBe('de')

    mockApi.put.mockRejectedValueOnce(new Error('server exploded'))
    const saved = await store.setLocale('en')

    expect(saved).toBe(false)
    expect(store.saveError).toBeInstanceOf(Error)
    // Nothing may claim a language the server did not take: the interface,
    // the `<html lang>` attribute, the boot cache and the stored preference
    // all go back to the state the server confirmed.
    expect(store.locale).toBe('de')
    expect(i18n.global.locale.value).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(localStorage.getItem(PERSISTED_LOCALE_KEY)).toBe('de')
    expect(store.preference).toBe('de')
  })

  it('clears the stored preference when the operator picks "automatic"', async () => {
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'de' },
      '/config': { default_lang: 'en' },
    })
    const store = useLocaleStore()
    await store.init()
    expect(store.locale).toBe('de')

    await store.setLocale(null)

    // `null` is a value in the backend contract, not the absence of one.
    expect(mockApi.put).toHaveBeenCalledWith('/user-preferences/locale', { locale: null })
    expect(store.preference).toBeNull()
    // The instance default takes over again.
    expect(store.locale).toBe('en')
    expect(store.source).toBe('instance')
  })

  it('rejects a locale this build ships no catalogue for', async () => {
    routeApi({ ...GUEST, '/config': { default_lang: 'en' } })
    const store = useLocaleStore()
    await store.init()

    const saved = await store.setLocale('fr')

    expect(saved).toBe(false)
    expect(store.locale).toBe('en')
    expect(mockApi.put).not.toHaveBeenCalled()
  })

  it('keeps the preference the server holds even when it cannot render it', async () => {
    // The server knows a language this build has no catalogue for. The
    // interface falls back to the instance default, but the stored value
    // is the server's business, not the frontend's to discard.
    routeApi({
      ...SIGNED_IN,
      '/user-preferences/locale': { locale: 'fr' },
      '/config': { default_lang: 'de' },
    })
    const store = useLocaleStore()
    await store.init()

    expect(store.preference).toBe('fr')
    expect(store.locale).toBe('de')
    expect(store.source).toBe('instance')
  })

  it('a language chosen while the boot round trip is in flight survives it', async () => {
    // The preference GET is still on its way when the operator picks a
    // language. The answer that arrives afterwards is older than the
    // choice, so it must not overwrite it.
    let release: (value: { locale: string | null }) => void = () => {}
    let issued: () => void = () => {}
    const requested = new Promise<void>((resolve) => {
      issued = resolve
    })
    mockApi.get.mockImplementation((path: string) => {
      if (path === '/user-preferences/locale') {
        issued()
        return new Promise((resolve) => {
          release = resolve
        })
      }
      if (path === '/auth/me') return Promise.resolve({ user: { id: 1, name: 'Ada' } })
      if (path === '/config') return Promise.resolve({ default_lang: 'en' })
      return Promise.reject(new Error(`unrouted: ${path}`))
    })

    const store = useLocaleStore()
    const booting = store.init()
    await requested

    await store.setLocale('de')
    expect(store.locale).toBe('de')

    release({ locale: null })
    await booting

    expect(store.locale).toBe('de')
    expect(store.preference).toBe('de')
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