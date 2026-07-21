export interface AgentTool {
  tool_class: string
  tool_name: string
  /** Resolved icon key (3-layer chain applied server-side: tool.icon → plugin.icon → 'puzzle').
   *  Optional; null falls back to 'puzzle' via the <Icon> component's own fallback. */
  icon?: string | null
}

export interface Agent {
  id: number
  name: string
  description: string | null
  system_prompt: string | null
  llm_driver_config_id: number | null
  /** Whether the configured LLM driver + model accepts image content blocks. */
  llm_supports_image_input?: boolean
  max_steps: number
  is_active: boolean
  allow_continuation?: boolean
  retry_after_minutes?: number
  max_retries?: number
  /**
   * When this agent was created. Optional until the backend surfaces it
   * on `AgentResource`; consumers must fall back to last-task `updated_at`
   * when absent.
   */
  created_at?: string
  /**
   * Whether the operator has pinned this agent to the top of the dashboard.
   * Optional because the backend does not yet emit it; consumers must
   * tolerate undefined as `false`.
   */
  is_pinned?: boolean
  /**
   * Whether the agent has been archived (hidden from the default view).
   * Optional because the backend does not yet emit it; consumers must
   * tolerate undefined as `false`.
   */
  is_archived?: boolean
  /**
   * Whether the operator has favorited this agent for quick access on
   * the dashboard. Optional because the backend only started emitting
   * it with the favorites-flag PR; consumers must tolerate undefined
   * as `false`.
   */
  is_favorite?: boolean
  tools: AgentTool[]
}

export interface LLMConfigSettings {
  'core.openai.api_key'?: string
  'core.anthropic.api_key'?: string
  'core.openai.base_url'?: string
  'core.anthropic.base_url'?: string
}
