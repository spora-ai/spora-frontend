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
  created_at: string
  updated_at: string
}
