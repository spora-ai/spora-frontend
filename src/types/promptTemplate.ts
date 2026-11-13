export interface PromptTemplateVariable {
  key: string
  label?: string
  default_value?: string
}

export interface PromptTemplateResource {
  id: number
  agent_id: number
  name: string
  description: string | null
  prompt_template: string
  variables: PromptTemplateVariable[]
  max_steps: number | null
  /**
   * The reasoning-effort level this template runs at.
   *
   * `null` means "inherit": the agent's default, then the configuration's.
   * The empty string is not a state here — a template either names a level
   * or it does not.
   */
  effort: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}
