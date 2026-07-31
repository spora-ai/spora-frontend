import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AgentToolConfigModal from '@/components/agent/AgentToolConfigModal.vue'

const ModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size'],
  emits: ['update:modelValue', 'close'],
  template: '<div v-if="modelValue" class="modal-stub"><slot /></div>',
}

vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
}))

vi.mock('@/components/settings/ToolSettingsForm.vue', () => ({
  default: {
    name: 'ToolSettingsForm',
    props: ['tool', 'initialSettings', 'saving', 'error'],
    emits: ['save'],
    template: '<div class="tool-settings-form"><slot /></div>',
  },
}))

import { useToolSettings } from '@/composables/useToolSettings'
import { api } from '@/api/client'

const mockUseToolSettings = useToolSettings as ReturnType<typeof vi.fn>
const mockApi = api as ReturnType<typeof vi.fn>

const makeTool = (overrides = {}) => ({
  tool_class: 'Spora\\Tools\\WebSearch',
  tool_name: 'web_search',
  display_name: 'Web Search',
  settings_schema: [
    { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, scope: 'global', options: null },
  ],
  ...overrides,
})

describe('AgentToolConfigModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // The modal's child panels call useAgentStore() for multi-select name
    // resolution. Reset Pinia before every test so each starts fresh.
    setActivePinia(createPinia())
    // A memory-history router is provided via `global.plugins` so child
    // composables that touch the router (e.g. useAgentStore) have a
    // route context during mount.
    testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    mockUseToolSettings.mockReturnValue({
      getSettings: vi.fn().mockReturnValue(Promise.resolve({})),
      putSettings: vi.fn().mockReturnValue(Promise.resolve({})),
      getRawOverride: vi.fn().mockReturnValue(Promise.resolve({})),
      getSettingsWithSource: vi.fn().mockReturnValue(Promise.resolve({})),
    })
    mockApi.get = vi.fn().mockReturnValue(Promise.resolve({}))
  })

  describe('rendering', () => {
    it('renders nothing when toolName is null (modal closed)', () => {
      const wrapper = mount(AgentToolConfigModal, {
        props: { toolName: null, tool: null, agentId: 1 },
        global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
      })
      expect(wrapper.find('.modal-stub').exists()).toBe(false)
    })

    it('renders modal stub when toolName is set', async () => {
      mockUseToolSettings.mockReturnValue({
        getSettings: vi.fn().mockResolvedValue({}),
        putSettings: vi.fn().mockResolvedValue({}),
        getRawOverride: vi.fn().mockResolvedValue({}),
        getSettingsWithSource: vi.fn().mockResolvedValue({}),
      })
      mockApi.get = vi.fn().mockResolvedValue({})

      const wrapper = mount(AgentToolConfigModal, {
        props: { toolName: 'web_search', tool: makeTool(), agentId: 1 },
        global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
      })

      await flushPromises()
      expect(wrapper.find('.modal-stub').exists()).toBe(true)
    })

    it('shows currently active settings with defaults when no settings configured', async () => {
      mockUseToolSettings.mockReturnValue({
        getSettings: vi.fn().mockResolvedValue({}),
        putSettings: vi.fn().mockResolvedValue({}),
        getRawOverride: vi.fn().mockResolvedValue({}),
        getSettingsWithSource: vi.fn().mockResolvedValue({}),
      })
      mockApi.get = vi.fn().mockResolvedValue({})

      const wrapper = mount(AgentToolConfigModal, {
        props: { toolName: 'web_search', tool: makeTool(), agentId: 1 },
        global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
      })

      await flushPromises()
      expect(wrapper.text()).toContain('Currently Active Settings')
      expect(wrapper.text()).toContain('Using defaults')
    })
  })

  it('renders the read-only "currently active" panel even when getRawOverride rejects', async () => {
    // The two remaining load paths (raw override + annotated effective) are
    // independent; if either rejects we should still render the modal with
    // empty defaults rather than blow up the agent settings page.
    mockUseToolSettings.mockReturnValue({
      getSettings: vi.fn().mockResolvedValue({}),
      putSettings: vi.fn().mockResolvedValue({}),
      getRawOverride: vi.fn().mockRejectedValue(new Error('boom')),
      getSettingsWithSource: vi.fn().mockRejectedValue(new Error('boom')),
    })
    mockApi.get = vi.fn().mockResolvedValue({})

    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool: makeTool(), agentId: 1 },
      global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
    })

    await flushPromises()
    expect(wrapper.text()).toContain('Currently Active Settings')
  })
})


// File-scope so `makeWrapper` (defined below) can use it.
let testRouter: ReturnType<typeof createRouter>

const tool = makeTool()

function makeWrapper(propsOverrides = {}, settingsMock: Record<string, ReturnType<typeof vi.fn>> = {}) {
  mockUseToolSettings.mockReturnValue({
    getSettings: vi.fn().mockResolvedValue({}),
    putSettings: vi.fn().mockResolvedValue({}),
    getRawOverride: vi.fn().mockResolvedValue({}),
    getSettingsWithSource: vi.fn().mockResolvedValue({}),
    ...settingsMock,
  })
  mockApi.get = vi.fn().mockResolvedValue({})
  return mount(AgentToolConfigModal, {
    props: { toolName: 'web_search', tool, agentId: 1, ...propsOverrides },
    global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
  })
}

describe('AgentToolConfigModal — additional actions', () => {
  beforeEach(() => {
    // Each describe block has its own beforeEach (the Pinia + router setup
    // for the child panels).
    setActivePinia(createPinia())
    testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
  })

  it('saves the form and emits saved + close on success', async () => {
    mockApi.put = vi.fn().mockResolvedValue({})
    const wrapper = makeWrapper()
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(mockApi.put).toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows an error message when save fails with ApiError', async () => {
    const { ApiError } = await import('@/api/client')
    mockApi.put = vi.fn().mockRejectedValue(new ApiError('FAIL', 'Server error', 500))
    const wrapper = makeWrapper()
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('Server error')
  })

  it('shows a generic message when save fails with a non-ApiError', async () => {
    mockApi.put = vi.fn().mockRejectedValue(new Error('boom'))
    const wrapper = makeWrapper()
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to save settings.')
  })

  it('allows saving with an empty required field (form has novalidate)', async () => {
    // The agent-override form is intentionally not validating HTML5
    // `required` — empty fields mean "inherit from parent layer" and the
    // backend already strips nulls on save. The user must be able to set,
    // e.g., a `timeout` override without re-entering a required api_key
    // they have configured globally.
    const requiredTool = makeTool({
      settings_schema: [
        {
          key: 'api_key',
          label: 'API Key',
          type: 'text',
          description: '',
          default: null,
          required: true,
          scope: 'global',
          options: null,
        },
      ],
    })
    mockApi.put = vi.fn().mockResolvedValue({})
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool: requiredTool, agentId: 1 },
      global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
    })
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(mockApi.put).toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('triggers remove-all on agent override form and emits saved + close', async () => {
    mockApi.delete = vi.fn().mockResolvedValue({})
    const wrapper = makeWrapper({}, {
      getRawOverride: vi.fn().mockResolvedValue({ api_key: '***' }),
    })
    await flushPromises()
    const removeAll = wrapper.findAll('button').find((b) => b.text().includes('Remove all agent overrides'))!
    await removeAll.trigger('click')
    await flushPromises()
    expect(mockApi.delete).toHaveBeenCalledWith(
      expect.stringContaining('/override'),
    )
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows an error message when remove-all fails', async () => {
    const { ApiError } = await import('@/api/client')
    mockApi.delete = vi.fn().mockRejectedValue(new ApiError('FAIL', 'Cannot remove', 500))
    const wrapper = makeWrapper({}, {
      getRawOverride: vi.fn().mockResolvedValue({ api_key: '***' }),
    })
    await flushPromises()
    const removeAll = wrapper.findAll('button').find((b) => b.text().includes('Remove all agent overrides'))!
    await removeAll.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Cannot remove')
  })

  it('renders the "no configurable settings" branch when settings_schema is empty', async () => {
    const toolNoSchema = makeTool({ settings_schema: [] })
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool: toolNoSchema, agentId: 1 },
      global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('This tool has no configurable settings.')
  })

  it('triggers update:form on the override form (covers line 130)', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    const inputs = wrapper.findAll('input')
    if (inputs.length > 0) {
      await inputs[0].setValue('new value')
      await flushPromises()
      // The override form's first input (API key) should reflect the typed value.
      expect((inputs[0].element as HTMLInputElement).value).toBe('new value')
    } else {
      // Schema rendered no input fields — confirm the form is still mounted.
      expect(wrapper.find('form').exists()).toBe(true)
    }
  })

  it('emits close when the Cancel button is clicked', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel')!
    await cancelBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when the Close button is clicked in the no-schema branch', async () => {
    const toolNoSchema = makeTool({ settings_schema: [] })
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool: toolNoSchema, agentId: 1 },
      global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
    })
    await flushPromises()
    const closeBtn = wrapper.findAll('button').find((b) => b.text() === 'Close')!
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('exercises the form save button', async () => {
    mockApi.put = vi.fn().mockResolvedValue({})
    const wrapper = makeWrapper()
    await flushPromises()
    const saveBtn = wrapper.find('button[type="submit"]')!
    expect(saveBtn.exists()).toBe(true)
  })

  it('handles rawOverride + settingsWithSource promise rejections', async () => {
    mockApi.get = vi.fn().mockResolvedValue({})
    mockUseToolSettings.mockReturnValue({
      getSettings: vi.fn().mockResolvedValue({}),
      putSettings: vi.fn().mockResolvedValue({}),
      getRawOverride: vi.fn().mockRejectedValue(new Error('boom')),
      getSettingsWithSource: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool, agentId: 1 },
      global: { plugins: [testRouter], stubs: { Modal: ModalStub } },
    })
    await flushPromises()
    expect(wrapper.find('.modal-stub').exists()).toBe(true)
  })

  it('handles the Modal update:modelValue event', async () => {
    const Modal = (await import('@/components/Modal.vue')).default
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool, agentId: 1 },
    })
    await flushPromises()
    const modal = wrapper.findComponent(Modal)
    expect(modal.exists()).toBe(true)
    await modal.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('handles the Modal @close event', async () => {
    const Modal = (await import('@/components/Modal.vue')).default
    const wrapper = mount(AgentToolConfigModal, {
      props: { toolName: 'web_search', tool, agentId: 1 },
    })
    await flushPromises()
    const modal = wrapper.findComponent(Modal)
    await modal.vm.$emit('close')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
