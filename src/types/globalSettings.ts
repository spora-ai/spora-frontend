/**
 * Hand-written against `GlobalSettingsController` in spora-core. The SPA does
 * not consume `openapi.json` — the controller is the source of truth, and this
 * file is the transcription of its wire shape.
 */

export type GlobalSettingType =
  | 'toggle'
  | 'text'
  | 'number'
  | 'select'
  | 'password'
  | 'multi-select'
  | 'textarea'
  | 'list'

/**
 * Which layer the value currently comes from, lowest precedence first. Always
 * present on the wire: without it the page cannot tell an operator that a
 * `.env` entry is about to be shadowed by a row saved here.
 */
export type GlobalSettingSource = 'default' | 'config.php' | 'env' | 'database'

/** Whether a change takes effect on the next request or only after a worker restart. */
export type GlobalSettingAppliesOn = 'request' | 'worker_restart'

export interface GlobalSettingOption {
  value: string
  label: string
}

/**
 * `options` is `{value,label}[]` for `select` and `string[]` for
 * `multi-select`/`list`; empty for every other type.
 */
export type GlobalSettingOptions = GlobalSettingOption[] | string[]

export type GlobalSettingValue = string | boolean | number | string[] | null

export interface GlobalSetting {
  key: string
  /**
   * Storage discriminator used by `DELETE /admin/settings/{group}/{key}`.
   * Not the same as the section: every setting except mail's lives in
   * `framework` while spanning several sections.
   */
  group: string
  label: string
  type: GlobalSettingType
  description: string
  value: GlobalSettingValue
  default: GlobalSettingValue
  source: GlobalSettingSource
  /** `bootOnly` — read from `.env`/`config.php` before the database is open, so not editable here. */
  readonly: boolean
  /** The real value never crosses the wire; `value` is the literal `'***'`. */
  secret: boolean
  /** The stored row could not be decrypted; this setting is running on its default. */
  undecryptable: boolean
  applies_on: GlobalSettingAppliesOn
  options: GlobalSettingOptions
}

export interface GlobalSettingSection {
  key: string
  label: string
  settings: GlobalSetting[]
}

export interface GlobalSettingsPayload {
  sections: GlobalSettingSection[]
  /** Keys whose stored row could not be decrypted, across every group. */
  undecryptable: string[]
}

export interface GlobalSettingUpdate {
  group: string
  key: string
  value: GlobalSettingValue
}