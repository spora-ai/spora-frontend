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
 *   POST /api/v1/speech/provider-configs/set-default   body: { provider_class, scope, group_id? }
 *     → { config: SpeechProviderConfig } (with is_default=true)
 *
 *   GET  /api/v1/speech/preference?scope=user[&group_id=N]
 *     → { preference: PreferredSpeech }
 *
 *   PUT  /api/v1/speech/preference   body: { provider_class, scope, group_id? }
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
  provider_display_name: string
  scope: SpeechProviderScope
  display_name: string
  settings: Record<string, string>
  /**
   * True only for the single row flagged as the global default. The
   * backend enforces at most one `is_default = true` row across all
   * global-scope configs; the SPA renders a "Default" badge in the list
   * and gates the "Set as Global Default" action on this flag.
   */
  is_default: boolean
  created_at: string
  updated_at: string
}

/**
 * Caller's preferred STT provider class. Wins the cascade after the
 * agent override but before the global default. `provider_class === null`
 * means "no preference — fall back to the global default." `scope` is
 * `'user'` for Settings → Speech and `'group'` for the group page;
 * `group_id` is set when scope is `'group'`.
 *
 * Wire shape for `GET /api/v1/speech/preference` and
 * `PUT /api/v1/speech/preference` body.
 */
export interface PreferredSpeech {
  provider_class: string | null
  scope: 'user' | 'group'
  group_id: number | null
}
