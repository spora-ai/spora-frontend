/**
 * runtimeSettings — the pure side of the split settings pages.
 *
 * The mapping from a registry section to a page is the part that can rot
 * quietly. A section added to the registry and not added here would render on no
 * page at all: no error, no empty slot, the operator simply never sees it. So
 * the fallback and the filtering are both asserted rather than assumed.
 */
import { describe, it, expect } from 'vitest'
import {
  displayValue,
  draftValue,
  pageForSection,
  secretState,
  sectionsForPage,
  sourceColumn,
  sourceLabel,
  systemSections,
  toWireValue,
} from '@/lib/runtimeSettings'
import type { GlobalSetting, GlobalSettingSection } from '@/types/globalSettings'

function setting(overrides: Partial<GlobalSetting> = {}): GlobalSetting {
  return {
    key: 'SPORA_KEY',
    group: 'framework',
    label: 'A setting',
    type: 'text',
    description: '',
    value: '',
    default: '',
    source: 'default',
    readonly: false,
    secret: false,
    undecryptable: false,
    options: [],
    ...overrides,
  }
}

function section(key: string, settings: GlobalSetting[]): GlobalSettingSection {
  return { key, label: key, settings }
}

/** Mirrors the shape after the file-only change: sections holding both kinds. */
const sections: GlobalSettingSection[] = [
  section('general', [
    setting({ key: 'SPORA_APP_NAME' }),
    setting({ key: 'SPORA_APP_ENV', readonly: true }),
  ]),
  section('access', [setting({ key: 'SPORA_ALLOW_REGISTRATION', type: 'toggle', value: true })]),
  section('database', [
    setting({ key: 'SPORA_DB_HOST', readonly: true }),
    setting({ key: 'SPORA_DB_PASSWORD', readonly: true, secret: true, source: 'env', value: '***' }),
  ]),
  section('mail', [setting({ key: 'SPORA_MAIL_HOST' })]),
  section('realtime', [
    setting({ key: 'SPORA_MERCURE_URL' }),
    setting({ key: 'SPORA_KEY_PATH', readonly: true, secret: true, value: '***' }),
  ]),
  section('worker', [
    setting({ key: 'SPORA_TICK_LEASE_SECONDS' }),
    setting({ key: 'SPORA_MAX_WORKERS', readonly: true }),
  ]),
  section('timeouts', [setting({ key: 'SPORA_LLM_TIMEOUT' })]),
  section('media', [setting({ key: 'SPORA_ASSET_STORE_MODE' })]),
  section('plugins', [setting({ key: 'SPORA_PLUGIN_INSTALL_ENABLED', type: 'toggle' })]),
]

describe('pageForSection', () => {
  it('bundles by the task an operator is doing, not by the section name', () => {
    expect(pageForSection('mail')).toBe('mail')
    // Mercure is outbound delivery, so it belongs with mail.
    expect(pageForSection('realtime')).toBe('mail')
    expect(pageForSection('worker')).toBe('worker')
    expect(pageForSection('timeouts')).toBe('worker')
    expect(pageForSection('plugins')).toBe('media')
  })

  it('sends an unmapped section to the fallback rather than nowhere', () => {
    expect(pageForSection('a-section-added-after-this-file')).toBe('other')
  })
})

describe('sectionsForPage', () => {
  it('renders only the sections mapped to the page', () => {
    expect(sectionsForPage(sections, 'mail').map((s) => s.key)).toEqual(['mail', 'realtime'])
  })

  it('drops the read-only settings inside a section that also has editable ones', () => {
    // `general`, `worker` and `realtime` each hold both after the file-only
    // change. Filtering per section would drop the editable key or keep the
    // dead one.
    const general = sectionsForPage(sections, 'general').find((s) => s.key === 'general')!

    expect(general.settings.map((s) => s.key)).toEqual(['SPORA_APP_NAME'])
  })

  it('drops a section whose every setting is read-only', () => {
    const everyKey = sectionsForPage(sections, 'general')
      .concat(sectionsForPage(sections, 'mail'))
      .concat(sectionsForPage(sections, 'worker'))
      .concat(sectionsForPage(sections, 'media'))
      .flatMap((s) => s.settings.map((setting) => setting.key))

    // `database` is entirely file-only, so it belongs to no editable page.
    expect(everyKey).not.toContain('SPORA_DB_HOST')
  })

  it('carries an unmapped section along with General so it cannot vanish', () => {
    const withUnknown = [
      ...sections,
      section('a-section-added-after-this-file', [setting({ key: 'SPORA_BRAND_NEW' })]),
    ]

    const keys = sectionsForPage(withUnknown, 'general').flatMap((s) => s.settings.map((x) => x.key))

    expect(keys).toContain('SPORA_BRAND_NEW')
  })

  it('places every editable setting on exactly one page', () => {
    const editable = sections.flatMap((s) => s.settings.filter((x) => !x.readonly))
    const placed = ['general', 'mail', 'worker', 'media']
      .flatMap((page) => sectionsForPage(sections, page as 'general').flatMap((s) => s.settings.map((x) => x.key)))

    expect(placed.sort()).toEqual(editable.map((s) => s.key).sort())
  })
})

describe('systemSections', () => {
  it('collects every read-only setting under its own section label', () => {
    const keys = systemSections(sections).flatMap((s) => s.settings.map((x) => x.key))

    expect(keys).toEqual(
      expect.arrayContaining([
        'SPORA_APP_ENV',
        'SPORA_DB_HOST',
        'SPORA_DB_PASSWORD',
        'SPORA_KEY_PATH',
        'SPORA_MAX_WORKERS',
      ]),
    )
    expect(systemSections(sections).map((s) => s.key)).toEqual(['general', 'database', 'realtime', 'worker'])
  })

  it('never returns an editable setting', () => {
    const readonlyKeys = systemSections(sections).flatMap((s) => s.settings.map((x) => x.key))

    expect(readonlyKeys).not.toContain('SPORA_MAIL_HOST')
    expect(readonlyKeys).not.toContain('SPORA_APP_NAME')
  })
})

describe('toWireValue', () => {
  it('omits a read-only setting even if a value reached the draft', () => {
    expect(toWireValue(setting({ readonly: true, value: 'prod' }), 'evil')).toBeUndefined()
  })

  it('sends a list as the text the operator typed', () => {
    expect(toWireValue(setting({ type: 'list' }), 'png\njpeg')).toBe('png\njpeg')
  })

  it('turns a toggle into a boolean', () => {
    expect(toWireValue(setting({ type: 'toggle' }), true)).toBe(true)
    expect(toWireValue(setting({ type: 'toggle' }), 'false')).toBe(false)
  })
})

describe('draftValue', () => {
  it('seeds a list one item per line rather than as JSON', () => {
    expect(draftValue(setting({ type: 'list', value: ['png', 'jpeg'] }))).toBe('png\njpeg')
  })

  it('can seed from an explicit value, so a re-read can restore an in-flight edit', () => {
    expect(draftValue(setting({ type: 'text', value: 'server' }), 'client')).toBe('client')
  })

  /**
   * The server masks every secret unconditionally, so `'***'` arrives whether or
   * not a credential exists. Seeding the field with it renders `••••••••` plus a
   * *Change* button — an SMTP password that is not set, displayed as one that
   * is. `source` is the only thing on the wire that distinguishes the two.
   */
  it('seeds an unset secret empty, so no field claims a password that does not exist', () => {
    const unset = setting({ key: 'SPORA_MAIL_PASSWORD', type: 'password', secret: true, source: 'default', value: '***' })

    expect(draftValue(unset)).toBe('')
  })

  it('still seeds the mask for a secret that is actually configured', () => {
    for (const source of ['env', 'config.php', 'database'] as const) {
      const configured = setting({ type: 'password', secret: true, source, value: '***' })

      expect(draftValue(configured)).toBe('***')
    }
  })

  it('leaves an unset non-secret at its declared value', () => {
    expect(draftValue(setting({ value: '', source: 'default' }))).toBe('')
    expect(draftValue(setting({ value: 'prod', source: 'env' }))).toBe('prod')
  })
})

describe('secretState', () => {
  it('says "Not set" when no layer ever supplied a value', () => {
    expect(secretState(setting({ secret: true, source: 'default', value: '***' }))).toBe('Not set')
  })

  it('distinguishes set from unset even though the wire sends "***" for both', () => {
    expect(secretState(setting({ secret: true, source: 'env', value: '***' }))).toBe('Set (from env)')
    expect(secretState(setting({ secret: true, source: 'database', value: '***' }))).toBe('Set (from database)')
    expect(secretState(setting({ secret: true, source: 'config.php', value: '***' }))).toBe('Set (from config.php)')
  })

  it('reports the unreadable case rather than claiming a usable credential', () => {
    expect(secretState(setting({ secret: true, source: 'database', undecryptable: true, value: '***' })))
      .toContain('unreadable')
  })

  it('never returns the mask as if it were the value', () => {
    const states = [
      setting({ secret: true, source: 'default' }),
      setting({ secret: true, source: 'env' }),
      setting({ secret: true, source: 'database', undecryptable: true }),
    ].map(secretState)

    expect(states.every((state) => state !== '***')).toBe(true)
  })
})

describe('sourceLabel', () => {
  it('names the layer each value came from', () => {
    expect(sourceLabel('default')).toBe('the built-in default')
    expect(sourceLabel('config.php')).toBe('your `config.php`')
    expect(sourceLabel('env')).toBe('your `.env`')
    expect(sourceLabel('database')).toBe('the database')
  })
})

describe('sourceColumn', () => {
  it('names the layer each value came from', () => {
    expect(sourceColumn('default')).toBe('Default')
    expect(sourceColumn('config.php')).toBe('config.php')
    expect(sourceColumn('env')).toBe('.env')
    expect(sourceColumn('database')).toBe('Database')
  })
})

describe('displayValue', () => {
  it('says On and Off rather than true and false', () => {
    expect(displayValue(setting({ type: 'toggle', value: true }))).toBe('On')
    expect(displayValue(setting({ type: 'toggle', value: false }))).toBe('Off')
    expect(displayValue(setting({ type: 'toggle', value: 'true' }))).toBe('On')
  })

  it('renders an unset value as empty, so the caller can name it', () => {
    expect(displayValue(setting({ value: '' }))).toBe('')
    expect(displayValue(setting({ value: null }))).toBe('')
  })

  it('joins a list so a long allowlist wraps instead of truncating', () => {
    expect(displayValue(setting({ type: 'list', value: ['png', 'jpeg'] }))).toBe('png, jpeg')
  })
})