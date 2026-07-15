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
  /** Whether the configured LLM driver + model accepts image content blocks. */
  llm_supports_image_input?: boolean
  max_steps: number
  is_active: boolean
  allow_continuation?: boolean
  retry_after_minutes?: number
  max_retries?: number
  tools: AgentTool[]
}

export interface LLMConfigSettings {
  'core.openai.api_key'?: string
  'core.anthropic.api_key'?: string
  'core.openai.base_url'?: string
  'core.anthropic.base_url'?: string
}
