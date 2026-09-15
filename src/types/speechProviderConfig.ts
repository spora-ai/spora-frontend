/**
 * Wire shapes for the speech provider configuration endpoints:
 *
 *   GET  /api/v1/speech/provider-configs
 *     → {@link SpeechProviderConfigListResponse}
 *
 *   GET  /api/v1/speech/provider-configs/schema
 *     → {@link SpeechProviderSchemaListResponse}
 *
 *   POST /api/v1/speech/provider-configs   body: { provider_class, scope, settings }
 *     → {@link SpeechProviderConfigEnvelope}
 *
 *   PUT  /api/v1/speech/provider-configs/{id}   body: { settings }
 *     → {@link SpeechProviderConfigEnvelope}
 *
 *   DELETE /api/v1/speech/provider-configs/{id}
 *     → { data: { deleted: true } }
 *
 *   POST /api/v1/speech/provider-configs/{id}/set-default
 *     → { config: SpeechProviderConfig } (with is_default=true)
 *
 *   GET  /api/v1/speech/preference?scope=user[&group_id=N]
 *     → { preference: PreferredSpeech }
 *
 *   PUT  /api/v1/speech/preference   body: { config_id, scope, group_id? }
 *     → { preference: PreferredSpeech }
 *
 * The schema is read live from the backend's `ToolConfigSchemaInspector`,
 * so adding a new `SpeechToTextProviderInterface` implementation on the
 * server makes it appear here automatically.
 */
export type SpeechProviderScope = 'global' | 'user' | 'group' | 'agent'

export interface SpeechProviderConfigSettingsSchema {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'toggle' | 'textarea' | 'multi-select'
  description?: string
  default?: string | null
  required?: boolean
  validation?: string
  /**
   * Option list for `select` and `multi-select` fields. PHP serialises a
   * `key => label` array to a JSON object; the form normalises both shapes
   * into `{value, label}` so the renderer can iterate uniformly. See
   * {@link normalizeSelectOptions}.
   */
  options?: Array<{ value: string; label: string }> | Record<string, string>
}

export interface SpeechProviderClassSchema {
  class: string
  display_name: string
  settings_schema: SpeechProviderConfigSettingsSchema[]
}

export interface SpeechProviderConfig {
  id: number
  provider_class: string
  /** Short provider name from `SpeechToTextProviderInterface::getName()`. */
  provider_name: string | null
  /** Friendly provider label from `SpeechToTextProviderInterface::getDisplayName()`. */
  provider_display_name: string | null
  /**
   * Derived from `is_global` + `principal_id` server-side:
   * `is_global = true` → `'global'`;
   * `is_global = false, principal.type = 'user'` → `'user'`;
   * `is_global = false, principal.type = 'group'` → `'group'`.
   */
  scope: SpeechProviderScope
  display_name: string
  settings: Record<string, string>
  /** Admin-only flag: true when this row is the global default. */
  is_default: boolean
  /** True for global-scope rows; `principal_id` is null when true. */
  is_global: boolean
  /** `principals.id` for principal-scoped rows; null for global rows. */
  principal_id: number | null
  created_at: string
  updated_at: string
}

/**
 * Caller's preferred STT config. Wins the cascade after the agent
 * override but before the global default. `config_id === null` means
 * "no preference — fall back to the global default." `scope` is `'user'`
 * for Settings → Speech and `'group'` for the group page; `group_id` is
 * set when scope is `'group'`.
 *
 * Wire shape for `GET /api/v1/speech/preference` and
 * `PUT /api/v1/speech/preference` body.
 */
export interface PreferredSpeech {
  config_id: number | null
  scope: 'user' | 'group'
  group_id: number | null
}
