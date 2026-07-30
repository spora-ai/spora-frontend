// Type definitions for the Agent Template system.
// Mirrors `spora-core/agent-template.schema.json`. Settings (passwords,
// API keys) are intentionally NOT representable here — the backend
// never exports them and the importer never writes them.

export interface AgentTemplateOperation {
  name: string
  enabled?: boolean
  auto_approve?: boolean
}

export interface AgentTemplateTool {
  tool_class: string
  enabled: boolean
  operations: AgentTemplateOperation[]
  /**
   * Optional agent-specific tool settings (e.g. an active skill
   * allowlist). Only present when the source agent has a non-empty
   * agent_tool_overrides row AND the operator opted in via
   * `?include_settings=1`. Password-typed keys are NEVER present, and
   * null/empty values are stripped.
   */
  settings?: Record<string, unknown>
}

export interface AgentTemplateAgent {
  description?: string
  system_prompt?: string
  max_steps?: number
  allow_followup?: boolean
  retry_after_minutes?: number
  max_retries?: number
}

export interface AgentTemplateMetadata {
  category?: string
  icon?: string
  /**
   * Profile-picture archetype (one of the 8 `Archetype` enum values).
   * Optional — the template only carries it when the source agent has
   * an archetype avatar (not when the agent uses an uploaded image,
   * since image data is not exportable through the template system).
   */
  archetype?: string
  /**
   * Variant index within the chosen archetype. Omit to auto-derive
   * from `fnv1a(agent_id) % 3` on import.
   */
  variant_key?: string
  /** Predefined FG+BG palette key (one of the 10 `Palette` enum values). */
  palette_key?: string
}

export interface AgentTemplate {
  $schema?: string
  id: string
  name: string
  description?: string
  version: string
  agent: AgentTemplateAgent
  tools: AgentTemplateTool[]
  required_plugins: string[]
  metadata: AgentTemplateMetadata
}

export interface AgentTemplateSummary {
  id: string
  name: string
  description?: string
  version: string
  source: string
  filename?: string | null
  category?: string
  icon?: string
  tools_count: number
  required_plugins: string[]
  has_warnings: boolean
}

export type TemplateWarningSeverity = 'error' | 'warning' | 'info'

export interface TemplateWarning {
  code: string
  severity: TemplateWarningSeverity
  message: string
  path?: string
}

export interface TemplateValidationResult {
  valid: boolean
  errors: TemplateWarning[]
  warnings: TemplateWarning[]
}

export interface TemplateImportToolResult {
  tool_class: string
  enabled: boolean
  operations_applied: number
  warnings: TemplateWarning[]
}

export interface AgentTemplateImportResult {
  agent: {
    id: number
    name: string
    description: string | null
    system_prompt: string | null
    llm_driver_config_id: number | null
    max_steps: number
    is_active: boolean
    allow_followup: boolean
    retry_after_minutes: number
    max_retries: number
  }
  warnings: TemplateWarning[]
  tools_enabled: TemplateImportToolResult[]
}

export interface AgentTemplateExportResponse {
  template: AgentTemplate
  /** Surfaced when the export omits secrets/settings. */
  inline_warning: string
  /**
   * Present when `include_settings=1` was used AND at least one tool
   * emitted a `settings` block. E.g. "Included 2 tool setting(s) for:
   * SkillTool, TimeTool. Passwords and inherited global/user values
   * are NOT included."
   */
  inline_info?: string
}

export interface AgentTemplateShowResponse {
  template: AgentTemplate
  warnings: TemplateWarning[]
  source: string | null
  filename: string | null
}