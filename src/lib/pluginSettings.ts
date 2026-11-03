/**
 * The grouping behind the Plugins tab.
 *
 * The registry keeps every plugin's settings in one section — `plugins` — and
 * each plugin's rows under its own storage group, `plugin:<slug>`. The tab is
 * therefore one section with groups inside it rather than a page per group:
 * the plugin system's own settings and a plugin's settings are the same kind
 * of thing and belong on the same tab.
 *
 * The groups are read off the settings the payload carries and not off a list
 * of installed plugins, so a plugin that contributes no settings contributes
 * no group — there is nothing to configure, and an empty group would be a
 * heading over nothing.
 */
import { i18n } from '@/i18n'
import type { GlobalSetting, GlobalSettingSection } from '@/types/globalSettings'

/** The registry section the Plugins tab owns. */
export const PLUGINS_SECTION = 'plugins'

/** The storage discriminator a plugin's own settings are kept under. */
export const PLUGIN_GROUP_PREFIX = 'plugin:'

/**
 * The section's settings, split into the groups they are stored under.
 *
 * A file-only setting is left out: it cannot be changed here, and the
 * System page is where the settings that live in the files are listed.
 */
export function pluginSections(section: GlobalSettingSection | undefined): GlobalSettingSection[] {
  if (section === undefined) return []

  const groups = new Map<string, GlobalSetting[]>()
  for (const setting of section.settings) {
    if (setting.readonly) continue
    const existing = groups.get(setting.group)
    if (existing === undefined) groups.set(setting.group, [setting])
    else existing.push(setting)
  }

  return [...groups.entries()].map(([group, settings]) => ({
    key: group,
    label: groupLabel(group),
    settings,
  }))
}

/**
 * The heading for one group.
 *
 * The host's own plugin settings live in the `framework` group — the group
 * every other section's settings live in — so the group key says nothing
 * about them, and they are named for what they are: the plugin system's own
 * settings.
 *
 * A plugin's settings live under `plugin:<slug>`, and the slug is the only
 * name the payload carries. The plugin's display name lives in the plugin
 * inventory, which this tab does not read.
 */
function groupLabel(group: string): string {
  if (!group.startsWith(PLUGIN_GROUP_PREFIX)) return i18n.global.t('Plugin system')
  return humanise(group.slice(PLUGIN_GROUP_PREFIX.length))
}

/** `team-graph` reads as "Team graph"; a slug without a separator is one word. */
function humanise(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  if (words === '') return slug
  return words.charAt(0).toUpperCase() + words.slice(1)
}
