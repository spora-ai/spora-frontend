// Thin wrapper around the api client for the Agent Template endpoints.
// Mirrors `AgentTemplateController` on the backend.
import { api } from './client'
import type {
  AgentTemplate,
  AgentTemplateExportResponse,
  AgentTemplateImportResult,
  AgentTemplateShowResponse,
  AgentTemplateSummary,
  TemplateValidationResult,
} from '@/types/agentTemplate'

export const agentTemplatesApi = {
  /** GET /agent-templates — list built-in + plugin templates */
  list: () => api.get<{ templates: AgentTemplateSummary[] }>('/agent-templates'),

  /** GET /agent-templates/{id} — single template, full payload + warnings */
  show: (id: string) => api.get<AgentTemplateShowResponse>(`/agent-templates/${encodeURIComponent(id)}`),

  /** POST /agent-templates/validate — dry-run validation, no DB write */
  validate: (payload: AgentTemplate) =>
    api.post<TemplateValidationResult>('/agent-templates/validate', payload),

  /** POST /agent-templates/import — create agent from a payload */
  import: (payload: AgentTemplate) =>
    api.post<AgentTemplateImportResult>('/agent-templates/import', payload),

  /** GET /agents/{id}/export — export an agent as a template JSON */
  exportAgent: (id: number) =>
    api.get<AgentTemplateExportResponse>(`/agents/${id}/export`),
}