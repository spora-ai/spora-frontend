// Pinia store for the Agent Template system.
// Loads the built-in + plugin template list, validates uploaded files,
// creates agents from templates, and exports existing agents as JSON.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { agentTemplatesApi } from '@/api/agentTemplates'
import { ApiError } from '@/api/client'
import type {
  AgentTemplate,
  AgentTemplateExportResponse,
  AgentTemplateImportResult,
  AgentTemplateShowResponse,
  AgentTemplateSummary,
  TemplateValidationResult,
} from '@/types/agentTemplate'

export const useAgentTemplateStore = defineStore('agentTemplates', () => {
  const templates = ref<AgentTemplateSummary[]>([])
  const current = ref<AgentTemplateShowResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchTemplates(): Promise<AgentTemplateSummary[]> {
    loading.value = true
    error.value = null
    try {
      const res = await agentTemplatesApi.list()
      templates.value = res.templates
      return res.templates
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load templates.'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function getTemplate(id: string): Promise<AgentTemplateShowResponse> {
    const res = await agentTemplatesApi.show(id)
    current.value = res
    return res
  }

  async function validatePayload(payload: AgentTemplate): Promise<TemplateValidationResult> {
    const res = await agentTemplatesApi.validate(payload)
    return res
  }

  async function importPayload(payload: AgentTemplate): Promise<AgentTemplateImportResult> {
    const res = await agentTemplatesApi.import(payload)
    return res
  }

  /**
   * Reads a File from a <input type="file"> and imports it as a template.
   * Throws on JSON parse failure or validation error; the caller is
   * expected to surface the message via the toast/alert pattern.
   */
  async function importTemplateFile(file: File): Promise<AgentTemplateImportResult> {
    const text = await file.text()
    let payload: AgentTemplate
    try {
      payload = JSON.parse(text) as AgentTemplate
    } catch (e) {
      throw new ApiError(`File is not valid JSON: ${(e as Error).message}`, 'INVALID_JSON', 0)
    }
    return importPayload(payload)
  }

  async function exportAgent(id: number): Promise<AgentTemplateExportResponse> {
    const res = await agentTemplatesApi.exportAgent(id)
    return res
  }

  return {
    templates,
    current,
    loading,
    error,
    fetchTemplates,
    getTemplate,
    validatePayload,
    importPayload,
    importTemplateFile,
    exportAgent,
  }
})