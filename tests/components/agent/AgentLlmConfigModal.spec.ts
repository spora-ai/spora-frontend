import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AgentLlmConfigModal from '@/components/agent/AgentLlmConfigModal.vue'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import type { LLMDriverInfo } from '@/types/llmConfig'

// Inline Modal stub — renders slot content directly, avoids Teleport issues
const ModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size'],
  emits: ['update:modelValue', 'close'],
  template: '<div v-if="modelValue" class="modal-stub"><slot /><slot name="footer" /></div>',
}

vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: vi.fn(),
}))

vi.mock('@/components/settings/ToolSettingsForm.vue', () => ({
  default: {
    name: 'ToolSettingsForm',
    props: ['tool', 'initialSettings', 'saving', 'error'],
    emits: ['save'],
    template: '<div class="tool-settings-form"><slot /></div>',
  },
}))

const mockUseLlmConfigsStore = vi.mocked(useLlmConfigsStore)

const OPENAI_DRIVER_CLASS = String.raw`Spora\Drivers\OpenAICompatibleDriver`
const ANTHROPIC_DRIVER_CLASS = String.raw`Spora\Drivers\AnthropicCompatibleDriver`

const mockDrivers: LLMDriverInfo[] = [
  {
    name: 'openai_compatible',
    display_name: 'OpenAI Compatible',
    driver_class: OPENAI_DRIVER_CLASS,
    settings_schema: [
      { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, options: null, expose_to_llm: false },
      { key: 'model', label: 'Model', type: 'text', description: '', default: 'gpt-4o', required: false, options: null, expose_to_llm: false },
    ],
  },
  {
    name: 'anthropic_compatible',
    display_name: 'Anthropic Compatible',
    driver_class: ANTHROPIC_DRIVER_CLASS,
    settings_schema: [
      { key: 'api_key', label: 'API Key', type: 'password', description: '', default: null, required: false, options: null, expose_to_llm: false },
    ],
  },
]

/**
 * The store mock carries only the members the modal calls; the real store
 * has the full surface, so the partial stand-in is cast to it.
 */
function mockStore(partial: Partial<ReturnType<typeof useLlmConfigsStore>>): void {
  mockUseLlmConfigsStore.mockReturnValue(partial as ReturnType<typeof useLlmConfigsStore>)
}

/**
 * The modal's `<script setup>` bindings.
 *
 * A `<script setup>` component publishes only what `defineExpose` exports on
 * its public instance, so `internals(wrapper).formSettings` does not type-check.
 */
type AgentLlmConfigModalVm = {
  formName: string
  formDriverClass: string
  formSettings: Record<string, string>
  error: string | null
  close: () => void
}

function internals(wrapper: { vm: unknown }): AgentLlmConfigModalVm {
  return wrapper.vm as unknown as AgentLlmConfigModalVm
}

describe('AgentLlmConfigModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  describe('renders correctly', () => {
    it('renders Modal when show=true', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()
      expect(wrapper.findComponent({ name: 'Modal' }).exists()).toBe(true)
    })

    it('does not render modal stub when show=false', () => {
      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: false, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })
      // The ModalStub's template has v-if="modelValue", so nothing renders when show=false
      expect(wrapper.find('.modal-stub').exists()).toBe(false)
    })

    it('shows driver options from llmDrivers prop', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()
      expect(wrapper.text()).toContain('OpenAI Compatible')
      expect(wrapper.text()).toContain('Anthropic Compatible')
    })

    it('shows driver selection prompt when no driver selected', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()
      expect(wrapper.text()).toContain('Select a driver above to see available settings fields')
    })
  })

  describe('driver selection', () => {
    it('popsulates formSettings with driver defaults when driver selected', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      // formSettings should now have defaults from the driver's schema
      expect(internals(wrapper).formSettings).toEqual({ model: 'gpt-4o' })
    })
  })

  describe('form validation', () => {
    it('Create button is disabled when name is empty', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      expect(createBtn?.attributes('disabled')).toBeDefined()
    })

    it('Create button is disabled when no driver selected', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      // Fill in name but no driver
      await wrapper.find('input[type="text"]').setValue('My Config')

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      expect(createBtn?.attributes('disabled')).toBeDefined()
    })

    it('Create button is enabled when name and driver are set', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      // Fill in name
      await wrapper.find('input[type="text"]').setValue('My Config')
      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      expect(createBtn?.attributes('disabled')).toBeUndefined()
    })
  })

  describe('submit creates config', () => {
    it('calls llmStore.createConfig with correct payload', async () => {
      const createConfig = vi.fn().mockResolvedValue({
        id: 5,
        name: 'My Config',
        driver_class: OPENAI_DRIVER_CLASS,
        driver_name: 'openai_compatible',
        driver_display_name: 'OpenAI Compatible',
        settings: { model: 'gpt-4o' },
        is_default: false,
      })
      mockStore({ createConfig })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      // Fill name and select driver
      await wrapper.find('input[type="text"]').setValue('My Config')
      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      await createBtn!.trigger('click')

      await flushPromises()

      expect(createConfig).toHaveBeenCalledWith({
        name: 'My Config',
        driver_class: OPENAI_DRIVER_CLASS,
        settings: { model: 'gpt-4o' },
      })
    })

    it('emits created and update:show(false) on success', async () => {
      const createConfig = vi.fn().mockResolvedValue({
        id: 5,
        name: 'My Config',
        driver_class: OPENAI_DRIVER_CLASS,
        driver_name: 'openai_compatible',
        driver_display_name: 'OpenAI Compatible',
        settings: { model: 'gpt-4o' },
        is_default: false,
      })
      mockStore({ createConfig })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('My Config')
      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      await createBtn!.trigger('click')

      await flushPromises()

      expect(wrapper.emitted('created')).toBeDefined()
      expect(wrapper.emitted('update:show')).toBeDefined()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('sets error and keeps modal open when create fails', async () => {
      const createConfig = vi.fn().mockRejectedValue(new Error('Server error'))
      mockStore({ createConfig })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('My Config')
      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      const createBtn = wrapper.findAll('button').find((b) => b.text() === 'Create')
      await createBtn!.trigger('click')

      await flushPromises()
      await nextTick()

      // Plain Error is caught as 'Failed to create configuration.'
      expect(internals(wrapper).error).toBe('Failed to create configuration.')
      // Modal should still be visible
      expect(wrapper.find('.modal-stub').exists()).toBe(true)
    })
  })

  describe('close resets form', () => {
    it('resets formName, formDriverClass, formSettings when close is emitted', async () => {
      mockStore({
        createConfig: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      })

      const wrapper = mount(AgentLlmConfigModal, {
        props: { show: true, llmDrivers: mockDrivers },
        global: { stubs: { Modal: ModalStub } },
      })

      await flushPromises()

      // Fill in form
      await wrapper.find('input[type="text"]').setValue('My Config')
      const select = wrapper.find('select')
      await select.setValue(OPENAI_DRIVER_CLASS)
      await nextTick()

      // Reset
      internals(wrapper).close()
      await nextTick()

      expect(internals(wrapper).formName).toBe('')
      expect(internals(wrapper).formDriverClass).toBe('')
      expect(internals(wrapper).formSettings).toEqual({})
    })
  })
})
