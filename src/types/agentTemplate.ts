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
}

export interface AgentTemplateAgent {
  description?: string
  system_prompt?: string
  max_steps?: number
  allow_continuation?: boolean
  retry_after_minutes?: number
  max_retries?: number
}

export interface AgentTemplateMetadata {
  category?: string
  icon?: string
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
  inline_warning: string
}

export interface AgentTemplateShowResponse {
  template: AgentTemplate
  warnings: TemplateWarning[]
  source: string | null
  filename: string | null
}