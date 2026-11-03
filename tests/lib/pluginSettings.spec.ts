/**
 * pluginSettings — the grouping behind the Plugins tab.
 *
 * The registry keeps every plugin's settings in one section and each
 * plugin's rows under its own storage group, so the tab is one section with
 * groups inside it. These assertions pin the two things that can go quiet:
 * a plugin's settings land in that plugin's group, and a plugin that
 * contributed nothing contributes no group.
 */
import { describe, it, expect } from 'vitest'
import { PLUGINS_SECTION, PLUGIN_GROUP_PREFIX, pluginSections } from '@/lib/pluginSettings'
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

function pluginsSection(settings: GlobalSetting[]): GlobalSettingSection {
  return { key: PLUGINS_SECTION, label: 'Plugins', settings }
}

const coreSettings = [
  setting({ key: 'SPORA_PLUGIN_INSTALL_ENABLED', label: 'Allow plugin installation', type: 'toggle' }),
  setting({ key: 'SPORA_COMPOSER_BINARY', label: 'Composer binary' }),
]

const socialSettings = [
  setting({ key: 'SPORA_SOCIAL_LINKEDIN_CLIENT_ID', group: 'plugin:social', label: 'LinkedIn client id' }),
]

describe('pluginSections', () => {
  it('splits the section into the groups the settings are stored under', () => {
    const groups = pluginSections(pluginsSection([...coreSettings, ...socialSettings]))

    expect(groups.map((g) => g.key)).toEqual(['framework', 'plugin:social'])
    expect(groups[0]?.settings.map((s) => s.key)).toEqual([
      'SPORA_PLUGIN_INSTALL_ENABLED',
      'SPORA_COMPOSER_BINARY',
    ])
    expect(groups[1]?.settings.map((s) => s.key)).toEqual(['SPORA_SOCIAL_LINKEDIN_CLIENT_ID'])
  })

  it('names a plugin group after its slug and the host group for what it is', () => {
    const groups = pluginSections(pluginsSection([...coreSettings, ...socialSettings]))

    // The host's own settings live in the `framework` group — the group every
    // other section's settings live in — so the group key says nothing about
    // them.
    expect(groups[0]?.label).toBe('Plugin system')
    // The slug is the only name the payload carries.
    expect(groups[1]?.label).toBe('Social')
  })

  it('reads a slug with a separator as words', () => {
    const groups = pluginSections(
      pluginsSection([setting({ key: 'SPORA_TEAM_GRAPH_X', group: 'plugin:team-graph' })]),
    )

    expect(groups[0]?.label).toBe('Team graph')
  })

  it('adds no group for a plugin that contributed no settings', () => {
    const groups = pluginSections(pluginsSection(coreSettings))

    expect(groups).toHaveLength(1)
    expect(groups.some((g) => g.key.startsWith(PLUGIN_GROUP_PREFIX))).toBe(false)
  })

  it('leaves out a setting that cannot be edited here', () => {
    const groups = pluginSections(
      pluginsSection([...coreSettings, setting({ key: 'SPORA_PLUGIN_READONLY', readonly: true })]),
    )

    const keys = groups.flatMap((g) => g.settings.map((s) => s.key))
    expect(keys).not.toContain('SPORA_PLUGIN_READONLY')
  })

  it('has nothing to group when the section was not delivered', () => {
    expect(pluginSections(undefined)).toEqual([])
  })
})
