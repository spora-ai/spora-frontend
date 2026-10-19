/**
 * locale store — owns the active language and the `<html lang>` attribute.
 *
 * Resolution order, highest first:
 *
 *   1. the authenticated user's preference (`users.locale`, nullable)
 *   2. `default_lang` from the boot config (`SPORA_DEFAULT_LANG`)
 *   3. `'en'`
 *
 * `Accept-Language` is deliberately not consulted. The instance owner sets
 * one language for the install, and a browser header would make the same
 * user see two languages on two machines.
 *
 * The persisted value in `localStorage` is a *boot placeholder*, not a
 * source of truth: it paints the right language before the round trip
 * resolves, and `init()` then overwrites it with the authoritative answer.
 * Reading it as a fourth link in the chain would pin the browser to a stale
 * language forever, because nothing would ever demote it once
 * `SPORA_DEFAULT_LANG` changed.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import {
  FALLBACK_LOCALE,
  availableLocales,
  i18n,
  persistLocale,
  readPersistedLocale,
} from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

interface LocalePreferenceResponse {
  locale: string | null
}

/** Which link of the resolution chain produced the current locale. */
export type LocaleSource = 'cache' | 'preference' | 'instance' | 'fallback'

function isSupported(locale: unknown): locale is string {
  return typeof locale === 'string' && availableLocales.includes(locale)
}

export const useLocaleStore = defineStore('locale', () => {
  const cached = readPersistedLocale()
  const locale = ref<string>(cached ?? FALLBACK_LOCALE)
  const source = ref<LocaleSource>(cached === null ? 'fallback' : 'cache')
  const resolved = ref(false)

  let initPromise: Promise<void> | null = null

  function apply(next: string, from: LocaleSource): void {
    locale.value = next
    // The i18n instance is the thing every component reads, and
    // `documentElement.lang` is what screen readers and the browser's own
    // hyphenation/pronunciation dictionaries read. Both have to move
    // together or the page is visibly English with a German lang attribute.
    i18n.global.locale.value = next
    document.documentElement.lang = next
    persistLocale(next)
    source.value = from
  }

  /** Adopt a locale the operator picked. Wave C's language selector. */
  function setLocale(next: string): void {
    if (!isSupported(next)) return
    apply(next, 'preference')
  }

  /**
   * The user's own preference. A 404 is the expected answer on a backend
   * without the endpoint and an ordinary answer for a guest, so it is
   * swallowed here rather than surfaced — the chain continues to the
   * instance default, which is the correct answer for both cases.
   */
  async function resolveUserPreference(): Promise<string | null> {
    const auth = useAuthStore()
    if (!auth.initialized) await auth.init()
    if (auth.user === null) return null
    try {
      const res = await api.get<LocalePreferenceResponse>('/user-preferences/locale')
      return isSupported(res?.locale) ? res.locale : null
    } catch {
      return null
    }
  }

  function init(): Promise<void> {
    if (initPromise !== null) return initPromise

    initPromise = (async () => {
      const config = useRuntimeConfigStore()

      // Two independent round trips, started together. `/config` is needed
      // even when a preference wins, because it carries the feature flags
      // the router guard is about to read — so chaining them would add one
      // round trip's latency to every boot for nothing.
      const preferenceReady = resolveUserPreference()
      await Promise.all([preferenceReady, config.init()])

      const userPreference = await preferenceReady
      if (userPreference !== null) {
        apply(userPreference, 'preference')
      } else if (isSupported(config.defaultLang)) {
        apply(config.defaultLang, 'instance')
      } else {
        apply(FALLBACK_LOCALE, 'fallback')
      }
      resolved.value = true
    })()

    return initPromise
  }

  /**
   * Translate outside a component's `setup()`.
   *
   * `useI18n()` is only callable from setup scope. Delegated DOM handlers
   * (`src/copyCode.ts`) and store actions have no instance to inject into,
   * so they reach the global composer through here instead.
   *
   * Narrower than vue-i18n's own `ComposerTranslation` on purpose: that type
   * carries list/plural overloads this layer does not use, and spreading it
   * into a wrapper loses the overload set rather than widening it.
   */
  const t = (key: string, named?: Record<string, unknown>): string =>
    named === undefined ? i18n.global.t(key) : i18n.global.t(key, named)

  return {
    locale,
    source,
    resolved,
    availableLocales,
    t,
    init,
    setLocale,
  }
})