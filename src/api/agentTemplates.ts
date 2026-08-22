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

  /** POST /agent-templates/import — create agent from a payload.
   *  When `principalId` is set, the imported agent is owned by that
   *  principal (typically a group); otherwise it's owned by the caller's
   *  user-principal. Server-side authorisation still applies — the caller
   *  must be admin or control the target principal. */
  import: (payload: AgentTemplate, principalId: number | null = null) =>
    api.post<AgentTemplateImportResult>('/agent-templates/import', {
      ...payload,
      principal_id: principalId,
    }),

  /** GET /agents/{id}/export — export an agent as a template JSON.
   *  When `includeSettings` is true, appends `?include_settings=1` so the
   *  backend emits agent-specific (non-secret) tool settings blocks.
   */
  exportAgent: (id: number, includeSettings: boolean = false) =>
    api.get<AgentTemplateExportResponse>(
      `/agents/${id}/export${includeSettings ? '?include_settings=1' : ''}`,
    ),
}