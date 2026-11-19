
export interface LLMSettingsSchema {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea' | 'toggle'
  description: string
  default: unknown
  required: boolean
  options: Record<string, string> | string[] | null
  /**
   * Whether the setting's default is the value it takes when a stored
   * configuration does not carry the key.
   *
   * The backend fills such a default in before the form ever sees the
   * configuration, so the form does not act on this — it is here so the
   * schema shape the backend sends is described.
   */
  default_applies_when_absent?: boolean
  expose_to_llm: boolean
}

export interface LLMDriverInfo {
  name: string
  display_name: string
  driver_class: string
  settings_schema: LLMSettingsSchema[]
}

export interface LLMConfigResource {
  id: number
  name: string
  driver_class: string
  driver_name: string
  driver_display_name: string
  settings: Record<string, string>
  context_window: number | null
  max_tokens_output: number | null
  is_default: boolean
  is_global: boolean
  principal_id: number | null
  created_at: string
  updated_at: string
}

/**
 * The tier of the LLM cascade that supplied the effective configuration.
 *
 * The tiers belong to the principal that owns the agent, so `group_*` and
 * `user_*` describe the owner rather than the caller: a group-owned agent
 * resolves against the group's principal.
 *
 *   - `agent`            → the agent's own `llm_driver_config_id`
 *   - `group_preference` → the owning group's preferred configuration
 *   - `user_preference`  → the owning user's preferred configuration
 *   - `group_default`    → the owning group's own default configuration
 *   - `user_default`     → the owning user's own default configuration
 *   - `global_default`   → the global default configuration
 *   - `none`             → nothing is configured at all
 */
export type LLMConfigSource =
  | 'agent'
  | 'group_preference'
  | 'user_preference'
  | 'group_default'
  | 'user_default'
  | 'global_default'
  | 'none'

/** The effective configuration of an agent, as the backend resolved it. */
export interface EffectiveLLMConfig {
  config: LLMConfigResource | null
  source: LLMConfigSource
}
