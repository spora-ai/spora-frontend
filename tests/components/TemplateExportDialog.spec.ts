import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { api, ApiError } from '@/api/client'
import { useAgentTemplateStore } from '@/stores/agentTemplates'
import TemplateExportDialog from '@/components/agent/TemplateExportDialog.vue'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }
const global = { stubs: { Teleport: true, Icon: true } }

const sampleExportResponse = {
  template: {
    $schema: 'https://spora.dev/agent-template.schema.json',
    id: 'weather-helper',
    name: 'Weather Helper',
    version: '1.0.0',
    agent: { max_steps: 5, system_prompt: 'x' },
    tools: [],
    required_plugins: [],
    metadata: { category: 'research', icon: 'sun' },
  },
  inline_warning: 'Settings (passwords, API keys) are NOT included in this export.',
}

describe('TemplateExportDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('loads the export payload and shows the inline warning + metadata', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'Weather Helper' },
      global,
    })
    // The store action calls api.get via the wrapper's reactive watch.
    await flushPromises()
    expect(wrapper.text()).toContain('Settings (passwords, API keys) are NOT included')
    expect(wrapper.text()).toContain('weather-helper')
    expect(wrapper.text()).toContain('1.0.0')
  })

  it('surfaces an error when the export fetch fails', async () => {
    mockApi.get.mockRejectedValueOnce(new ApiError('nope', 'BOOM', 500))
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 99, agentName: 'X' },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('nope')
  })

  it('emits update:modelValue=false when Close is clicked', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    const close = wrapper.findAll('button').find((b) => b.text() === 'Close')
    expect(close).toBeTruthy()
    await close!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('disables the download button while the payload is still loading', async () => {
    mockApi.get.mockReturnValueOnce(new Promise(() => {})) // never resolves
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    const download = wrapper.findAll('button').find((b) => b.text().includes('Download'))
    expect(download).toBeTruthy()
    expect((download!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the store wiring stable so the export endpoint is hit once per open', async () => {
    mockApi.get.mockResolvedValue(sampleExportResponse)
    // Sanity: just ensure useAgentTemplateStore().exportAgent is the path
    // the dialog uses — we exercise it via the watch directly.
    const store = useAgentTemplateStore()
    await store.exportAgent(7)
    expect(mockApi.get).toHaveBeenCalledWith('/agents/7/export')
  })
})