/**
 * locale store — owns the active language and the `<html lang>` attribute.
 *
 * Resolution order, highest first:
 *
 *   1. the authenticated user's preference (`users.locale`, nullable)
 *   2. `default_lang` from the boot config (`SPORA_DEFAULT_LANG`)
 *   3. `'en'`
 *
 * `Accept-Language` is deliberately not consulted. The instance owner sets one
 * language for the install, and a browser header would make the same user see
 * two languages on two machines.
 *
 * The persisted value in `localStorage` is a *boot placeholder*, not a source
 * of truth: it paints the right language before the round trip resolves, and
 * `init()` then overwrites it with the authoritative answer. Reading it as a
 * fourth link in the chain would pin the browser to a stale language forever,
 * because nothing would ever demote it once `SPORA_DEFAULT_LANG` changed.
 *
 * The choice the operator makes is written to the server (`users.locale`), not
 * only to the browser: a preference that lives in `localStorage` alone is gone
 * on the next device, and undone by the next boot.
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
import { log } from '@/utils/logger'

interface LocalePreferenceResponse {
  /**
   * The stored preference. `null` is "automatic" — a value the backend
   * understands, not the absence of one.
   */
  locale: string | null
  /** The locale the server resolves to right now. */
  resolved?: string
  /**
   * Every locale the *server* ships a catalogue for. The picker does not offer
   * these: a plugin can register a language the frontend has no catalogue for,
   * and offering it would render the interface in raw keys. The frontend's own
   * `availableLocales` is the offerable set.
   */
  available?: string[]
}

/** Which link of the resolution chain produced the current locale. */
export type LocaleSource = 'cache' | 'preference' | 'instance' | 'fallback'

/** A locale the server is known to agree with. */
interface ConfirmedLocale {
  locale: string
  source: LocaleSource
  preference: string | null
}

function isSupported(locale: unknown): locale is string {
  return typeof locale === 'string' && availableLocales.includes(locale)
}

export const useLocaleStore = defineStore('locale', () => {
  const cached = readPersistedLocale()
  const locale = ref<string>(cached ?? FALLBACK_LOCALE)
  const source = ref<LocaleSource>(cached === null ? 'fallback' : 'cache')
  const resolved = ref(false)

  /**
   * The user's own stored choice, as the server holds it. `null` means
   * "automatic".
   *
   * Kept apart from `locale` because the two answer different questions:
   * `locale` is the language on screen, `preference` is what the server holds.
   * They differ whenever the instance default wins, which is exactly what the
   * "automatic" option stands for.
   */
  const preference = ref<string | null>(null)

  /**
   * The last save failed. The picker renders the message; the store keeps the
   * error itself, because a translated string would go stale on the next
   * locale change — the store does not re-translate what it already holds.
   */
  const saveError = ref<Error | null>(null)

  /**
   * The state the server is known to agree with. A failed save restores this
   * rather than the value that was on screen before the attempt: with two
   * saves in flight, the second one's "previous" value is the first one's
   * unconfirmed guess.
   */
  const confirmed = ref<ConfirmedLocale>({
    locale: locale.value,
    source: source.value,
    preference: null,
  })

  let initPromise: Promise<void> | null = null

  /**
   * Bumped by every save attempt. `init()` compares it before writing its
   * answer, so a language chosen while the boot round trip was still in flight
   * is not overwritten by the answer that was already on its way.
   */
  let saveGeneration = 0

  function apply(next: string, from: LocaleSource): void {
    locale.value = next
    // The i18n instance is the thing every component reads, and
    // `documentElement.lang` is what screen readers and the browser's own
    // hyphenation/pronunciation dictionaries read. Both have to move together
    // or the page is visibly English with a German lang attribute.
    i18n.global.locale.value = next
    document.documentElement.lang = next
    persistLocale(next)
    source.value = from
  }

  /** Put the interface back into a state the server has confirmed. */
  function restore(state: ConfirmedLocale): void {
    apply(state.locale, state.source)
    preference.value = state.preference
  }

  /**
   * Where "automatic" lands: the instance default, or `en` when the instance
   * names a language this build does not ship. The tail of the chain in
   * `init()`, reached from the other side.
   */
  function automaticTarget(): { locale: string; source: LocaleSource } {
    const instanceDefault = useRuntimeConfigStore().defaultLang
    return isSupported(instanceDefault)
      ? { locale: instanceDefault, source: 'instance' }
      : { locale: FALLBACK_LOCALE, source: 'fallback' }
  }

  /**
   * Adopt a locale the operator picked, and write it to the server.
   *
   * `null` is "automatic": the stored preference is cleared and the instance
   * default applies again.
   *
   * The local apply happens first and synchronously — the catalogues are
   * bundled, so the switch costs no round trip and waiting for one would make
   * the picker feel broken. The PUT then has to agree with it: a failure
   * restores the last confirmed language and reports the error, because an
   * interface that keeps showing a language the server has forgotten is a lie
   * that only surfaces at the next reload.
   *
   * Returns whether the server took the choice.
   */
  async function setLocale(next: string | null): Promise<boolean> {
    if (next !== null && !isSupported(next)) return false

    const generation = ++saveGeneration
    const target = next === null
      ? automaticTarget()
      : { locale: next, source: 'preference' as LocaleSource }

    apply(target.locale, target.source)
    preference.value = next
    saveError.value = null

    try {
      await api.put<LocalePreferenceResponse>('/user-preferences/locale', { locale: next })
      confirmed.value = { locale: target.locale, source: target.source, preference: next }
      return true
    } catch (e) {
      // A newer save has meanwhile replaced this one; its own outcome is the
      // one that counts, so this failure must not roll the interface back over
      // it.
      if (generation === saveGeneration) {
        restore(confirmed.value)
        saveError.value = e instanceof Error ? e : new Error(String(e))
        log.warn('[locale] PUT /user-preferences/locale failed; the previous language was restored', e)
      }
      return false
    }
  }

  /**
   * The user's own preference. A 404 is the expected answer on a backend
   * without the endpoint and an ordinary answer for a guest, so it is
   * swallowed here rather than surfaced — the chain continues to the instance
   * default, which is the correct answer for both cases.
   *
   * The stored value is returned as it is, supported or not: it is what the
   * server holds, and the picker needs the difference between "no preference"
   * and "a preference this build cannot render".
   */
  async function resolveUserPreference(): Promise<string | null> {
    const auth = useAuthStore()
    if (!auth.initialized) await auth.init()
    if (auth.user === null) return null
    try {
      const res = await api.get<LocalePreferenceResponse>('/user-preferences/locale')
      return typeof res?.locale === 'string' ? res.locale : null
    } catch {
      return null
    }
  }

  function init(): Promise<void> {
    if (initPromise !== null) return initPromise

    initPromise = (async () => {
      const config = useRuntimeConfigStore()
      const generation = saveGeneration

      // Two independent round trips, started together. `/config` is needed
      // even when a preference wins, because it carries the feature flags the
      // router guard is about to read — so chaining them would add one round
      // trip's latency to every boot for nothing.
      const preferenceReady = resolveUserPreference()
      await Promise.all([preferenceReady, config.init()])

      const userPreference = await preferenceReady

      if (saveGeneration !== generation) {
        // A language was chosen while the boot round trip was in flight.
        // That choice is newer than the answer on its way, so it wins.
        resolved.value = true
        return
      }

      preference.value = userPreference
      if (isSupported(userPreference)) {
        apply(userPreference, 'preference')
      } else if (isSupported(config.defaultLang)) {
        apply(config.defaultLang, 'instance')
      } else {
        apply(FALLBACK_LOCALE, 'fallback')
      }
      confirmed.value = {
        locale: locale.value,
        source: source.value,
        preference: userPreference,
      }
      resolved.value = true
    })()

    return initPromise
  }

  return {
    locale,
    source,
    resolved,
    preference,
    saveError,
    availableLocales,
    init,
    setLocale,
  }
})
