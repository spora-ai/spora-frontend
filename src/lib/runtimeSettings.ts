/**
 * Pure transforms behind the runtime-settings pages, plus the mapping that
 * decides which page a registry section lands on.
 *
 * The registry on the server owns the sections; this file owns the *bundling*.
 * The two are deliberately separate: a section is a fact about the setting, and
 * which page it appears on is a fact about how the interface is organised. The
 * registry should not have to know that mail and Mercure are one visit for an
 * operator setting up outbound delivery.
 */
import type { ToolSettingSchema } from '@/composables/useToolSettings'
import type {
  GlobalSetting,
  GlobalSettingOption,
  GlobalSettingSection,
  GlobalSettingSource,
  GlobalSettingValue,
} from '@/types/globalSettings'

/** A draft holds a toggle as a boolean and everything else as the text typed. */
export type DraftValue = string | boolean
export type Draft = Record<string, Record<string, DraftValue>>

export type RuntimePageKey = 'general' | 'mail' | 'worker' | 'media' | 'other'

export interface RuntimePage {
  key: RuntimePageKey
  label: string
  description: string
}

export const RUNTIME_PAGES: RuntimePage[] = [
  {
    key: 'general',
    label: 'General',
    description: 'What Spora is called, who may register, and who may create groups.',
  },
  {
    key: 'mail',
    label: 'Mail & Realtime',
    description: 'Outbound mail and Mercure, the two ways Spora talks to the outside.',
  },
  {
    key: 'worker',
    label: 'Worker & Performance',
    description: 'How queued work runs, and how long outbound requests may take.',
  },
  {
    key: 'media',
    label: 'Media & Plugins',
    description: 'Where uploaded files are kept, and what the plugin system may do.',
  },
]

/**
 * Sections are bundled by what an operator is doing, not by what the code calls
 * them. The registry calls Mercure's section `realtime` and puts it on the mail
 * page because the two are the same visit: configuring outbound delivery.
 */
const PAGE_MAP: Record<string, RuntimePageKey> = {
  general: 'general',
  access: 'general',
  mail: 'mail',
  realtime: 'mail',
  worker: 'worker',
  timeouts: 'worker',
  media: 'media',
  plugins: 'media',
}

export function pageForSection(sectionKey: string): RuntimePageKey {
  return PAGE_MAP[sectionKey] ?? 'other'
}

/**
 * Only editable settings, in the sections mapped to one page.
 *
 * Read-only settings are removed per setting rather than per section: after the
 * file-only change, `general`, `worker` and `realtime` each hold both, and a
 * section-level filter would either drop the editable keys or keep the disabled
 * ones.
 *
 * A section with no mapping lands on General rather than nowhere. A registry
 * section nobody thought about should show up in a form an operator can reach,
 * not vanish because this file was not updated — which is the failure the
 * fallback exists to prevent.
 */
export function sectionsForPage(
  sections: GlobalSettingSection[],
  pageKey: RuntimePageKey,
): GlobalSettingSection[] {
  return sections
    .map((section) => ({
      ...section,
      settings: section.settings.filter((setting) => !setting.readonly),
    }))
    .filter((section) => section.settings.length > 0)
    .filter((section) => {
      const mapped = pageForSection(section.key)
      return mapped === pageKey || (pageKey === 'general' && mapped === 'other')
    })
}

/** Every setting that comes from the files, grouped under its own section label. */
export function systemSections(sections: GlobalSettingSection[]): GlobalSettingSection[] {
  return sections
    .map((section) => ({
      ...section,
      settings: section.settings.filter((setting) => setting.readonly),
    }))
    .filter((section) => section.settings.length > 0)
}

/**
 * The draft form of a value. The `value` argument exists so a re-seed can put an
 * in-flight edit back on top of what the server just said, without having to
 * fake a setting object to read it through.
 */
export function draftValue(setting: GlobalSetting, value: GlobalSettingValue = setting.value): DraftValue {
  if (setting.type === 'toggle') return value === true || value === 'true'
  // One item per line, matching the textarea it seeds and the tokeniser on the
  // other side. JSON.stringify() also round-trips, but it ships the brackets
  // and quotes as part of every entry, and the server splits on whitespace — so
  // a list the operator merely edited came back stored as `"png"`, which
  // matches no real MIME subtype.
  if (Array.isArray(value)) return value.join('\n')
  return value === null || value === undefined ? '' : String(value)
}

/** The value that crosses the wire for one setting, or `undefined` to omit it. */
export function toWireValue(setting: GlobalSetting, value: DraftValue): GlobalSettingValue | undefined {
  if (setting.readonly) return undefined
  if (setting.type === 'toggle') return value === true || value === 'true'
  if (setting.type === 'multi-select') {
    if (typeof value !== 'string' || value.trim() === '') return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as string[]) : [String(value)]
    } catch {
      return [value]
    }
  }
  // `list` and every scalar type travel as the text the operator typed; the
  // server owns the splitting rules and the page does not re-shape them.
  return String(value)
}

function isLabelled(option: GlobalSettingOption | string): option is GlobalSettingOption {
  return typeof option === 'object' && option !== null
}

export function toFieldSchema(setting: GlobalSetting): ToolSettingSchema {
  const options: Array<GlobalSettingOption | string> = setting.options ?? []
  // The registry ships `{value,label}[]` for `select`; the shared field reads a
  // `value → label` map. `multi-select` ships bare strings, which the field
  // reads directly.
  const labelled = options.filter(isLabelled)
  const fieldOptions: Record<string, string> | string[] = labelled.length > 0
    ? Object.fromEntries(labelled.map((o) => [o.value, o.label]))
    : options.filter((o): o is string => typeof o === 'string')

  return {
    key: setting.key,
    label: setting.label,
    type: setting.type === 'list' ? 'textarea' : setting.type,
    description: setting.description,
    default: setting.default,
    required: false,
    options: Object.keys(fieldOptions).length > 0 ? fieldOptions : null,
    expose_to_llm: false,
  }
}

/** Where the value currently lives, in the wording an operator recognises. */
export const SOURCE_LABEL: Record<GlobalSettingSource, string> = {
  default: 'the built-in default',
  'config.php': 'your `config.php`',
  env: 'your `.env`',
  database: 'the database',
}

/**
 * A non-secret value as it should be *read*, rather than as a form control.
 * A toggle becomes a word, because "On" is what an operator would say and
 * `true` is what a serialiser would say.
 */
export function displayValue(setting: GlobalSetting): string {
  if (setting.type === 'toggle') {
    return setting.value === true || setting.value === 'true' ? 'On' : 'Off'
  }
  if (Array.isArray(setting.value)) return setting.value.join(', ')
  if (setting.value === null || setting.value === undefined) return ''
  return String(setting.value)
}

/**
 * Whether a secret has been given a value.
 *
 * The wire never carries one — `value` is the literal `'***'` whether the row
 * holds a credential or does not exist at all, so the mask cannot answer this.
 * `source` can: it is recorded per key, and is `default` only when neither
 * `config.php`, `.env` nor the database supplied anything. That leaves the one
 * case where "Set" alone would overstate things — a key present but empty in a
 * file — which naming the origin lets the operator see for themselves.
 */
export function secretState(setting: GlobalSetting): string {
  if (setting.undecryptable) return 'Set, but unreadable — set it again'
  if (setting.source === 'default') return 'Not set'
  return `Set (from ${setting.source})`
}