// Pinia store for the Agent Template system.
//
// Uses Pinia's Options API style so the HTTP-calling async actions live
// at the outer scope of the file (rather than nested inside the setup
// function). This keeps each async function individually testable and
// satisfies the S7721 "move async function to outer scope" lint.

import { defineStore } from 'pinia'
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

interface State {
  templates: AgentTemplateSummary[]
  current: AgentTemplateShowResponse | null
  loading: boolean
  error: string | null
}

async function fetchTemplatesImpl(): Promise<AgentTemplateSummary[]> {
  const res = await agentTemplatesApi.list()
  return res.templates
}

async function getTemplateImpl(id: string): Promise<AgentTemplateShowResponse> {
  return agentTemplatesApi.show(id)
}

async function validatePayloadImpl(payload: AgentTemplate): Promise<TemplateValidationResult> {
  return agentTemplatesApi.validate(payload)
}

async function importPayloadImpl(payload: AgentTemplate): Promise<AgentTemplateImportResult> {
  return agentTemplatesApi.import(payload)
}

async function exportAgentImpl(id: number): Promise<AgentTemplateExportResponse> {
  return agentTemplatesApi.exportAgent(id)
}

async function importTemplateFileImpl(file: File): Promise<AgentTemplateImportResult> {
  const text = await file.text()
  let payload: AgentTemplate
  try {
    payload = JSON.parse(text) as AgentTemplate
  } catch (e) {
    throw new ApiError(`File is not valid JSON: ${(e as Error).message}`, 'INVALID_JSON', 0)
  }
  return importPayloadImpl(payload)
}

export const useAgentTemplateStore = defineStore('agentTemplates', {
  state: (): State => ({
    templates: [],
    current: null,
    loading: false,
    error: null,
  }),

  actions: {
    async fetchTemplates(): Promise<AgentTemplateSummary[]> {
      this.loading = true
      this.error = null
      try {
        const list = await fetchTemplatesImpl()
        this.templates = list
        return list
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : 'Failed to load templates.'
        throw e
      } finally {
        this.loading = false
      }
    },

    async getTemplate(id: string): Promise<AgentTemplateShowResponse> {
      const res = await getTemplateImpl(id)
      this.current = res
      return res
    },

    async validatePayload(payload: AgentTemplate): Promise<TemplateValidationResult> {
      return validatePayloadImpl(payload)
    },

    async importPayload(payload: AgentTemplate): Promise<AgentTemplateImportResult> {
      return importPayloadImpl(payload)
    },

    async importTemplateFile(file: File): Promise<AgentTemplateImportResult> {
      return importTemplateFileImpl(file)
    },

    async exportAgent(id: number): Promise<AgentTemplateExportResponse> {
      return exportAgentImpl(id)
    },
  },
})