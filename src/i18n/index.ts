/**
 * i18n instance — Composition API only (`legacy: false`).
 *
 * The catalogues are bundled rather than fetched: `import.meta.glob` with
 * `eager: true` inlines every `src/locales/*.json` at build time, so a
 * locale switch never waits on the network. The alternative — a runtime
 * `fetch` per locale — would put a request on the critical path of every
 * first paint for a payload of a few KB.
 *
 * `en.json` is a generated identity map (`"Save": "Save"`), so the fallback
 * chain costs nothing and an unmigrated key renders as the English source
 * rather than as a raw key.
 */
import { createI18n } from 'vue-i18n'

export const FALLBACK_LOCALE = 'en'

/**
 * Where the resolved locale is cached so a reload paints in the right
 * language before the preference round trip resolves. It is a *boot
 * placeholder*, never a source of truth: `useLocaleStore.init()` overwrites
 * it with the authoritative answer (user preference → `default_lang` → `en`)
 * as soon as that arrives, so an instance that switches its default cannot
 * be pinned to a stale value by this key.
 */
export const PERSISTED_LOCALE_KEY = 'spora.locale'

const catalogues = import.meta.glob<Record<string, string>>('../locales/*.json', {
  eager: true,
  import: 'default',
})

export const messages = Object.fromEntries(
  Object.entries(catalogues).map(([path, catalogue]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
    catalogue,
  ]),
)

/**
 * Locales this build ships a catalogue for, `en` always present.
 *
 * Sorted with an explicit comparator rather than a bare `sort()`: the
 * default is a UTF-16 code-unit comparison, which orders by code point, so
 * it disagrees with any alphabetical reading once a locale code stops
 * being pure ASCII.
 */
export const availableLocales = Object.keys(messages).sort((a, b) => a.localeCompare(b))

/**
 * Read the cached boot locale. Returns `null` for anything absent or
 * unsupported rather than an arbitrary string: `localStorage` is
 * user-writable and survives across deploys, so an unknown value must not
 * reach `createI18n` and become the app's locale.
 */
export function readPersistedLocale(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(PERSISTED_LOCALE_KEY)
    return stored !== null && availableLocales.includes(stored) ? stored : null
  } catch {
    // Private-mode Safari and a `localStorage` blocked by policy both throw
    // on access. Boot must still work; it just loses the no-flash cache.
    return null
  }
}

export function persistLocale(locale: string): void {
  try {
    globalThis.localStorage?.setItem(PERSISTED_LOCALE_KEY, locale)
  } catch {
    // See readPersistedLocale — a failed cache write is not worth a boot failure.
  }
}

export function createAppI18n(locale: string) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: FALLBACK_LOCALE,
    messages,
  })
}

/**
 * The app's instance. `tests/setup.ts` builds its own via
 * `createAppI18n('en')` rather than importing this, so a developer's
 * cached `localStorage` locale can never change what the suite asserts.
 */
export const i18n = createAppI18n(readPersistedLocale() ?? FALLBACK_LOCALE)