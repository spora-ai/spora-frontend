/**
 * SettingsTable — the row-per-setting view that replaced the form.
 *
 * The assertions are mostly about *what is always present*. The complaint the
 * table answers is "where does this value come from", so a row that omits its
 * source has failed at its job even when every other column is right — which is
 * why `Default` is asserted rather than the absence of a badge.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import SettingsTable from '@/components/settings/runtime/SettingsTable.vue'
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
  } as GlobalSetting
}

const sections: GlobalSettingSection[] = [
  {
    key: 'mail',
    label: 'Mail',
    settings: [
      setting({ key: 'SPORA_MAIL_HOST', label: 'Mail host', value: 'smtp.example.com', source: 'env' }),
      setting({ key: 'SPORA_MAIL_PORT', label: 'Mail port', value: '587', source: 'env' }),
      setting({
        key: 'SPORA_MAIL_PASSWORD',
        label: 'Mail password',
        type: 'password',
        source: 'database',
        secret: true,
        value: '***',
      }),
      setting({
        key: 'SPORA_KEY_PATH',
        label: 'Secret key file',
        source: 'default',
        readonly: true,
        value: '/srv/secret.key',
      }),
    ],
  },
]

function mountTable(props: { sections?: GlobalSettingSection[]; editable?: boolean } = {}) {
  return mount(SettingsTable, {
    props: { sections: props.sections ?? sections, editable: props.editable ?? true },
  })
}

describe('SettingsTable', () => {
  it('shows the effective value and the key for every row', () => {
    const w = mountTable()

    expect(w.text()).toContain('smtp.example.com')
    expect(w.text()).toContain('SPORA_MAIL_HOST')
    expect(w.text()).toContain('Mail')
  })

  it('names the source on every row, including Default', () => {
    const w = mountTable()
    const sources = w.findAll('tbody tr td:nth-child(3)').map((td) => td.text())

    // Four rows, four labels, none blank.
    expect(sources).toHaveLength(4)
    expect(sources.every((s) => s.trim().length > 0)).toBe(true)
    expect(sources).toEqual(['.env', '.env', 'Database', 'Default'])
  })

  it('renders a toggle as a word rather than as true', () => {
    const w = mountTable({
      sections: [{
        key: 'access',
        label: 'Access',
        settings: [setting({ key: 'SPORA_ALLOW_REGISTRATION', type: 'toggle', value: true, source: 'env' })],
      }],
    })

    expect(w.text()).toContain('On')
    expect(w.text()).not.toContain('true')
  })

  it('reports a secret as a state, never as a filled field or the mask', () => {
    const w = mountTable()

    expect(w.text()).toContain('Set (from database)')
    expect(w.text()).not.toContain('***')
    expect(w.findAll('input')).toHaveLength(0)
  })

  it('marks an unset value in the muted style rather than leaving it blank', () => {
    const w = mountTable({
      sections: [{
        key: 'mail',
        label: 'Mail',
        settings: [setting({ key: 'SPORA_MAIL_FROM', value: '', source: 'default' })],
      }],
    })

    const valueCell = w.find('tbody tr td:nth-child(2)')

    expect(valueCell.text()).toBe('Not set')
    expect(valueCell.classes()).toContain('italic')
  })

  it('renders a value inherited from a file differently from one stored here', () => {
    const w = mountTable({
      sections: [{
        key: 'mail',
        label: 'Mail',
        settings: [
          setting({ key: 'SPORA_MAIL_HOST', value: 'smtp.example.com', source: 'env' }),
          setting({ key: 'SPORA_MAIL_PASSWORD', value: '***', source: 'database', secret: true }),
        ],
      }],
    })
    const [inherited, stored] = w.findAll('tbody tr td:nth-child(2)').map((td) => td.classes())

    // Both are in force right now, so they share the column — but only one of
    // them is this system's own. An inherited value changes under you when the
    // file does; a stored one survives that.
    expect(inherited).toContain('text-muted-foreground')
    expect(stored).not.toContain('text-muted-foreground')
  })

  it('styles Edit as a button rather than a bare link', () => {
    const w = mountTable()
    const edit = w.findAll('button').find((b) => b.text() === 'Edit Mail')!

    expect(edit.element.tagName).toBe('BUTTON')
    expect(edit.classes().join(' ')).toContain('border')
    expect(edit.classes().join(' ')).toContain('rounded-lg')
  })

  it('offers Clear only where a stored value would actually be given back', () => {
    const w = mountTable()
    const rows = w.findAll('tbody tr')
    const clearButtons = (row: unknown) =>
      (row as { findAll: (s: string) => { text: () => string }[] }).findAll('button').filter((b) => b.text() === 'Clear')

    // Only the database-sourced secret can be cleared; the `.env` rows have
    // nothing stored to delete, and offering it would be a button that does
    // nothing.
    expect(clearButtons(rows[2])).toHaveLength(1)
    expect(clearButtons(rows[0])).toHaveLength(0)
    expect(clearButtons(rows[3])).toHaveLength(0)
  })

  it('offers Edit once per section, not once per row', () => {
    const w = mountTable()

    // Four rows in one section: one link, naming what it opens.
    expect(w.findAll('tbody tr')).toHaveLength(4)
    expect(w.findAll('button').filter((b) => b.text().startsWith('Edit'))).toHaveLength(1)
    expect(w.findAll('button').map((b) => b.text())).toContain('Edit Mail')
  })

  it('emits the section key when the section is edited', async () => {
    const w = mountTable()

    await w.findAll('button').find((b) => b.text() === 'Edit Mail')!.trigger('click')

    expect(w.emitted('edit')).toEqual([['mail']])
  })

  it('offers one Edit per section when a page holds several', () => {
    const w = mountTable({
      sections: [
        { key: 'mail', label: 'Mail', settings: [setting({ key: 'A' }), setting({ key: 'B' })] },
        { key: 'realtime', label: 'Realtime', settings: [setting({ key: 'C' })] },
      ],
    })

    expect(w.findAll('button').filter((b) => b.text().startsWith('Edit')).map((b) => b.text()))
      .toEqual(['Edit Mail', 'Edit Realtime'])
  })

  it('offers no editing at all where nothing is editable', () => {
    const w = mountTable({ editable: false })

    expect(w.findAll('button')).toHaveLength(0)
  })

  it('says so when a page has nothing on it', () => {
    const w = mountTable({ sections: [] })

    expect(w.text()).toContain('No settings here.')
  })
})