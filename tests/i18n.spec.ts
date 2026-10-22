/**
 * The i18n layer itself: the identity-map guarantee the whole migration
 * rests on, the German catalogue actually reaching a rendered component,
 * and the message-compiler flag's real effect.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { availableLocales, createAppI18n, messages, readPersistedLocale } from '@/i18n'

describe('i18n catalogues', () => {
  it('bundles every locale this build ships', () => {
    expect(availableLocales).toEqual(['de', 'en'])
    expect(Object.keys(messages.en).length).toBeGreaterThan(0)
  })

  it('en.json is a flat identity map, generated from the source literals', () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(value).toBe(key)
    }
  })

  it('de.json translates every English key and no others', () => {
    expect(Object.keys(messages.de).sort()).toEqual(Object.keys(messages.en).sort())
  })

  it('de.json contains no placeholder left identical to its English source', () => {
    // `i18n:check` rule 3 enforces this too; asserting it here means a
    // catalogue edited outside the extractor is caught by `npm test` as well.
    for (const [key, value] of Object.entries(messages.de)) {
      expect(value.trim()).not.toBe('')
      expect(value).not.toBe(key)
    }
  })
})

describe('the identity-map guarantee', () => {
  it('resolves an English key to the English source, which is why unmigrated assertions hold', () => {
    // This is the property the suite's literal-copy assertions depend on.
    // If en.json ever stops being an identity map — a hand-edited entry, a
    // curated catalogue — those assertions start failing across the suite.
    const i18n = createAppI18n('en')
    expect(i18n.global.t('Pending')).toBe('Pending')
    expect(i18n.global.t('Awaiting Approval')).toBe('Awaiting Approval')
  })

  it('falls back to English for a key de.json does not carry', () => {
    // The fallback is the migration's safety net: a partially translated
    // catalogue renders the English source rather than a raw key.
    const i18n = createI18n({
      legacy: false,
      locale: 'de',
      fallbackLocale: 'en',
      messages: { en: { Only: 'Only' }, de: {} },
    })
    expect(i18n.global.t('Only')).toBe('Only')
  })
})

describe('the persisted boot locale', () => {
  it('returns null when the storage read throws', () => {
    // Private-mode Safari and a storage blocked by policy both throw on
    // access. The boot path must survive that, so the read is guarded.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('storage is blocked')
      },
      configurable: true,
    })
    try {
      expect(readPersistedLocale()).toBeNull()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
    }
  })
})

describe('a translated component', () => {
  it('renders the German label for a mounted StatusBadge', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'PENDING' },
      global: { plugins: [[createAppI18n('de')]] },
    })
    expect(wrapper.text()).toBe('Ausstehend')
  })

  it('renders the English label under the `en` instance the suite installs', () => {
    // No per-mount plugin: this is `tests/setup.ts` doing its job. If this
    // one breaks, every literal-copy assertion in the suite is at risk.
    const wrapper = mount(StatusBadge, { props: { status: 'AWAITING_SUB_AGENTS' } })
    expect(wrapper.text()).toBe('Awaiting Sub-agents')
  })
})

describe('the message compiler flag', () => {
  it('is NOT dropped, so interpolation and plurals actually run', () => {
    // Regression guard for `__INTLIFY_DROP_MESSAGE_COMPILER__`. The flag reads
    // like a tree-shaking optimisation but is not: with it set,
    // `@intlify/core-base`'s `compile()` returns the message verbatim and logs
    // a warning instead of throwing, so every `{named}` and `|` message ships
    // its raw source to the browser with nothing failing. Our catalogues are
    // JSON from `import.meta.glob`, never precompiled, so the compiler is
    // load-bearing.
    //
    // If someone restores the flag, this fails here rather than in a German
    // user's browser the first time a message interpolates.
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { greeting: 'Hello {name}', items: '{n} item | {n} items' } },
    })

    expect(i18n.global.t('greeting', { name: 'Ada' })).toBe('Hello Ada')
    expect(i18n.global.t('items', { n: 2 })).toBe('2 items')
  })
})