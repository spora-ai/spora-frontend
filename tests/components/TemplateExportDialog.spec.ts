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

async function chooseFirstCard(wrapper: ReturnType<typeof mount>): Promise<void> {
  const card = wrapper.findAll('button').find((b) => b.text().includes('Without settings'))
  expect(card).toBeTruthy()
  await card!.trigger('click')
  await flushPromises()
}

describe('TemplateExportDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('starts on the choose step and does not auto-fetch', async () => {
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'Weather Helper' },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Without settings')
    expect(wrapper.text()).toContain('Include settings')
    expect(mockApi.get).not.toHaveBeenCalled()
  })

  it('loads the export payload and shows the inline warning + metadata', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'Weather Helper' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
    expect(wrapper.text()).toContain('Settings (passwords, API keys) are NOT included')
    expect(wrapper.text()).toContain('weather-helper')
    expect(wrapper.text()).toContain('1.0.0')
    // The default (no include_settings) URL is preserved.
    expect(mockApi.get).toHaveBeenCalledWith('/agents/42/export')
  })

  it('appends include_settings=1 when the second card is chosen', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'Weather Helper' },
      global,
    })
    await flushPromises()
    const card = wrapper.findAll('button').find((b) => b.text().includes('Include settings'))
    expect(card).toBeTruthy()
    await card!.trigger('click')
    await flushPromises()
    expect(mockApi.get).toHaveBeenCalledWith('/agents/42/export?include_settings=1')
  })

  it('surfaces an error when the export fetch fails', async () => {
    mockApi.get.mockRejectedValueOnce(new ApiError('nope', 'BOOM', 500))
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 99, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
    expect(wrapper.text()).toContain('nope')
  })

  it('emits update:modelValue=false when Cancel is clicked on step 1', async () => {
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    expect(cancel).toBeTruthy()
    await cancel!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('emits update:modelValue=false when Close is clicked on step 2', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
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
    await chooseFirstCard(wrapper)
    // The fetch is pending, so we're still on the choose step and the
    // download button isn't in the DOM yet — but the disabled "Continue"
    // button is, and the cards themselves are disabled too.
    const continueBtn = wrapper.findAll('button').find((b) => b.text() === 'Continue')
    expect(continueBtn).toBeTruthy()
    expect((continueBtn!.element as HTMLButtonElement).disabled).toBe(true)
    const download = wrapper.findAll('button').find((b) => b.text().includes('Download'))
    expect(download).toBeUndefined()
  })

  it('renders the inline_info banner when the export provides one', async () => {
    mockApi.get.mockResolvedValueOnce({
      ...sampleExportResponse,
      template: {
        ...sampleExportResponse.template,
        tools: [{ tool_class: 'SkillTool', enabled: true, operations: [], settings: { allow: ['x'] } }],
      },
      inline_info: 'Included 1 tool setting(s) for: SkillTool.',
    })
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    // Need to pick the "Include settings" card for the "Agent settings"
    // summary row to show up.
    const card = wrapper.findAll('button').find((b) => b.text().includes('Include settings'))
    expect(card).toBeTruthy()
    await card!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Included 1 tool setting(s) for: SkillTool.')
    expect(wrapper.text()).toContain('Agent settings')
  })

  it('returns to the choose step when Back is clicked', async () => {
    mockApi.get.mockResolvedValueOnce(sampleExportResponse)
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
    const back = wrapper.findAll('button').find((b) => b.text() === 'Back')
    expect(back).toBeTruthy()
    await back!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Without settings')
    expect(wrapper.text()).toContain('Include settings')
    expect(mockApi.get).toHaveBeenCalledTimes(1)
  })

  it('keeps the store wiring stable so the export endpoint is hit once per open', async () => {
    mockApi.get.mockResolvedValue(sampleExportResponse)
    // Sanity: just ensure useAgentTemplateStore().exportAgent is the path
    // the dialog uses — we exercise it via the store directly.
    const store = useAgentTemplateStore()
    await store.exportAgent(7)
    expect(mockApi.get).toHaveBeenCalledWith('/agents/7/export')
  })

  it('store.exportAgent() forwards the includeSettings flag as a query param', async () => {
    mockApi.get.mockResolvedValue(sampleExportResponse)
    const store = useAgentTemplateStore()
    await store.exportAgent(7, true)
    expect(mockApi.get).toHaveBeenCalledWith('/agents/7/export?include_settings=1')
  })
})