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

  it('disables the cards while the payload is still loading', async () => {
    mockApi.get.mockReturnValueOnce(new Promise(() => {})) // never resolves
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
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

  it('does not auto-advance to step 2 when the dialog is closed during an in-flight fetch', async () => {
    // Race fix: if the user closes + reopens while a fetch is pending,
    // the stale resolution must not re-advance the dialog to step 2 or
    // overwrite the result the user sees after the new pick.
    let resolveFetch!: (value: typeof sampleExportResponse) => void
    mockApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve }))
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
    // Close + reopen the dialog while the fetch is still pending.
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    // Resolve the stale fetch — step must NOT auto-advance.
    resolveFetch(sampleExportResponse)
    await flushPromises()
    expect(wrapper.text()).toContain('Without settings')
    expect(wrapper.text()).not.toContain('Download .json')
  })

  it('reports the selected card as pressed (aria-pressed) even while loading', async () => {
    mockApi.get.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = mount(TemplateExportDialog, {
      props: { modelValue: true, agentId: 42, agentName: 'X' },
      global,
    })
    await flushPromises()
    await chooseFirstCard(wrapper)
    const cards = wrapper.findAll('button').filter((b) =>
      b.text().includes('Without settings') || b.text().includes('Include settings'),
    )
    const first = cards.find((b) => b.text().includes('Without settings'))
    const second = cards.find((b) => b.text().includes('Include settings'))
    expect((first!.element as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((second!.element as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the store wiring stable so the export endpoint is hit once per open', async () => {
    mockApi.get.mockResolvedValue(sampleExportResponse)
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