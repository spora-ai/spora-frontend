import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { api, ApiError } from '@/api/client'
import { useAgentTemplateStore } from '@/stores/agentTemplates'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const sampleTemplate = {
  $schema: 'https://spora.dev/agent-template.schema.json',
  id: 'core-assistant',
  name: 'Core',
  version: '1.0.0',
  agent: { max_steps: 5, system_prompt: 'x' },
  tools: [],
  required_plugins: [],
  metadata: { category: 'general', icon: 'puzzle' },
}

const sampleSummary = {
  id: 'core-assistant',
  name: 'Core',
  description: 'desc',
  version: '1.0.0',
  source: 'core',
  filename: 'core-assistant.json',
  category: 'general',
  icon: 'puzzle',
  tools_count: 0,
  required_plugins: [],
  has_warnings: false,
}

describe('useAgentTemplateStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('fetchTemplates() loads the list and stores it', async () => {
    mockApi.get.mockResolvedValueOnce({ templates: [sampleSummary] })
    const store = useAgentTemplateStore()
    const result = await store.fetchTemplates()
    expect(result).toEqual([sampleSummary])
    expect(store.templates).toEqual([sampleSummary])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(mockApi.get).toHaveBeenCalledWith('/agent-templates')
  })

  it('fetchTemplates() surfaces an error and rethrows on failure', async () => {
    mockApi.get.mockRejectedValueOnce(new ApiError('boom', 'BOOM', 500))
    const store = useAgentTemplateStore()
    await expect(store.fetchTemplates()).rejects.toThrow('boom')
    expect(store.error).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('getTemplate() stores the show response and returns it', async () => {
    mockApi.get.mockResolvedValueOnce({
      template: sampleTemplate,
      warnings: [],
      source: 'core',
      filename: 'core-assistant.json',
    })
    const store = useAgentTemplateStore()
    const res = await store.getTemplate('core-assistant')
    expect(res.template).toEqual(sampleTemplate)
    expect(store.current?.template).toEqual(sampleTemplate)
    expect(mockApi.get).toHaveBeenCalledWith('/agent-templates/core-assistant')
  })

  it('validatePayload() posts and returns the result', async () => {
    mockApi.post.mockResolvedValueOnce({ valid: true, errors: [], warnings: [] })
    const store = useAgentTemplateStore()
    const res = await store.validatePayload(sampleTemplate)
    expect(res.valid).toBe(true)
    expect(mockApi.post).toHaveBeenCalledWith('/agent-templates/validate', sampleTemplate)
  })

  it('importPayload() posts the import endpoint', async () => {
    mockApi.post.mockResolvedValueOnce({
      agent: { id: 1, name: 'Core' },
      warnings: [],
      tools_enabled: [],
    })
    const store = useAgentTemplateStore()
    const res = await store.importPayload(sampleTemplate)
    expect(res.agent.id).toBe(1)
    expect(mockApi.post).toHaveBeenCalledWith('/agent-templates/import', sampleTemplate)
  })

  it('importTemplateFile() parses JSON content and posts it', async () => {
    mockApi.post.mockResolvedValueOnce({
      agent: { id: 7, name: 'X' },
      warnings: [],
      tools_enabled: [],
    })
    const store = useAgentTemplateStore()
    const file = new File([JSON.stringify(sampleTemplate)], 'core-assistant.json', {
      type: 'application/json',
    })
    const res = await store.importTemplateFile(file)
    expect(res.agent.id).toBe(7)
    expect(mockApi.post).toHaveBeenCalledWith('/agent-templates/import', sampleTemplate)
  })

  it('importTemplateFile() throws ApiError on invalid JSON', async () => {
    const store = useAgentTemplateStore()
    const file = new File(['{ this is not json'], 'bad.json', {
      type: 'application/json',
    })
    await expect(store.importTemplateFile(file)).rejects.toThrow(/not valid JSON/)
  })

  it('exportAgent() gets the export endpoint and returns the payload', async () => {
    mockApi.get.mockResolvedValueOnce({
      template: sampleTemplate,
      inline_warning: 'Settings...',
    })
    const store = useAgentTemplateStore()
    const res = await store.exportAgent(42)
    expect(res.template.id).toBe('core-assistant')
    expect(res.inline_warning).toMatch(/Settings/)
    expect(mockApi.get).toHaveBeenCalledWith('/agents/42/export')
  })

  it('exportAgent() rethrows when the API call fails', async () => {
    // Mirrors the fetchTemplates() error test — the action passes the
    // API error straight through so callers can surface it.
    mockApi.get.mockRejectedValueOnce(new ApiError('boom', 'BOOM', 500))
    const store = useAgentTemplateStore()
    await expect(store.exportAgent(42)).rejects.toThrow('boom')
    expect(mockApi.get).toHaveBeenCalledWith('/agents/42/export')
  })
})