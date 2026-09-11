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
  type: 'text' | 'password' | 'select' | 'toggle' | 'textarea'
  description?: string
  default?: string | null
  required?: boolean
  validation?: string
  options?: Array<{ value: string; label: string }>
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

export interface SpeechProviderConfigListResponse {
  data: { configs: SpeechProviderConfig[] }
}

export interface SpeechProviderSchemaListResponse {
  data: { providers: SpeechProviderClassSchema[] }
}

export interface SpeechProviderConfigEnvelope {
  data: { config: SpeechProviderConfig }
}

export interface SpeechProviderDeleteResponse {
  data: { deleted: true }
}
