export interface AgentTool {
  tool_class: string
  tool_name: string
}

export interface Agent {
  id: number
  name: string
  description: string | null
  system_prompt: string | null
  llm_driver_config_id: number | null
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
  tools: AgentTool[]
}

export interface LLMConfigSettings {
  'core.openai.api_key'?: string
  'core.anthropic.api_key'?: string
  'core.openai.base_url'?: string
  'core.anthropic.base_url'?: string
}
