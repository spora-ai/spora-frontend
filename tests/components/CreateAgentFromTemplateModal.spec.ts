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
import CreateAgentFromTemplateModal from '@/components/agent/CreateAgentFromTemplateModal.vue'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }
const global = { stubs: { Teleport: true, Icon: true } }

const coreTemplate = {
  id: 'core-assistant',
  name: 'Core Assistant',
  description: 'Built-in starter agent.',
  version: '1.0.0',
  source: 'core',
  filename: 'core-assistant.json',
  category: 'general',
  icon: 'puzzle',
  tools_count: 4,
  required_plugins: [],
  has_warnings: false,
}

const pluginTemplate = {
  id: 'weather',
  name: 'Weather Helper',
  description: 'Uses the weather plugin.',
  version: '1.0.0',
  source: 'weather',
  filename: 'weather.json',
  category: 'research',
  icon: 'sun',
  tools_count: 2,
  required_plugins: ['weather'],
  has_warnings: true,
}

const coreShow = {
  template: {
    $schema: 'https://spora.dev/agent-template.schema.json',
    id: 'core-assistant',
    name: 'Core Assistant',
    version: '1.0.0',
    agent: { max_steps: 5, system_prompt: 'x' },
    tools: [],
    required_plugins: [],
    metadata: { category: 'general', icon: 'puzzle' },
  },
  warnings: [],
  source: 'core',
  filename: 'core-assistant.json',
}

describe('CreateAgentFromTemplateModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('renders the gallery grouped by source (core first, then plugins)', async () => {
    mockApi.get.mockResolvedValueOnce({ templates: [coreTemplate, pluginTemplate] })
    const wrapper = mount(CreateAgentFromTemplateModal, {
      props: { modelValue: true },
      global,
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Core Assistant')
    expect(text).toContain('Weather Helper')
    // "Core" header before "weather" header
    const coreIdx = text.indexOf('Core')
    const weatherIdx = text.indexOf('weather')
    expect(coreIdx).toBeGreaterThanOrEqual(0)
    expect(weatherIdx).toBeGreaterThan(coreIdx)
  })

  it('emits selected with the full template payload when a card is clicked', async () => {
    mockApi.get
      .mockResolvedValueOnce({ templates: [coreTemplate] })
      .mockResolvedValueOnce(coreShow)
    const wrapper = mount(CreateAgentFromTemplateModal, {
      props: { modelValue: true },
      global,
    })
    await flushPromises()
    const card = wrapper.findAll('button').find((b) => b.text().includes('Core Assistant'))
    expect(card).toBeTruthy()
    await card!.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('selected')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ template: coreShow.template, source: 'core' })
  })

  it('shows an empty-state message when no templates are available', async () => {
    mockApi.get.mockResolvedValueOnce({ templates: [] })
    const wrapper = mount(CreateAgentFromTemplateModal, {
      props: { modelValue: true },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No templates available')
  })

  it('surfaces an error when the template list fetch fails', async () => {
    mockApi.get.mockRejectedValueOnce(new ApiError('list broken', 'BOOM', 500))
    const wrapper = mount(CreateAgentFromTemplateModal, {
      props: { modelValue: true },
      global,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('list broken')
  })
})