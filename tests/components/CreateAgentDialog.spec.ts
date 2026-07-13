import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const createAgentMock = vi.fn()
const fetchAgentsMock = vi.fn()
const templatesRef = ref<Array<unknown>>([])
const templateStoreValidateMock = vi.fn()
const templateStoreImportMock = vi.fn()
const templateStoreGetMock = vi.fn()
const templateStoreFetchMock = vi.fn()

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    createAgent: createAgentMock,
    fetchAgents: fetchAgentsMock,
  }),
}))

vi.mock('@/stores/agentTemplates', () => ({
  useAgentTemplateStore: () => ({
    get templates() { return templatesRef.value },
    fetchTemplates: templateStoreFetchMock,
    getTemplate: templateStoreGetMock,
    validatePayload: templateStoreValidateMock,
    importPayload: templateStoreImportMock,
  }),
}))

const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

import { useCreateAgentDialogStore } from '@/stores/createAgentDialog'
import CreateAgentDialog from '@/components/agent/CreateAgentDialog.vue'

const global = { stubs: { Teleport: true, Icon: true } }

const blankForm = {
  name: 'Research Assistant',
  description: 'Research help',
  system_prompt: 'You help with research.',
}

beforeEach(() => {
  setActivePinia(createPinia())
  createAgentMock.mockReset()
  createAgentMock.mockResolvedValue({ id: 42, name: 'Research Assistant' })
  fetchAgentsMock.mockReset()
  templateStoreFetchMock.mockReset()
  templateStoreFetchMock.mockResolvedValue(undefined)
  templateStoreValidateMock.mockReset()
  templateStoreImportMock.mockReset()
  templateStoreGetMock.mockReset()
  templatesRef.value = []
  toastSuccessMock.mockReset()
  toastErrorMock.mockReset()
  pushMock.mockReset()
})

describe('CreateAgentDialog', () => {
  it('opens in the choice mode showing all three paths', async () => {
    const store = useCreateAgentDialogStore()
    store.open('choice')
    await flushPromises()
    const wrapper = mount(CreateAgentDialog, { global })
    expect(wrapper.text()).toContain('Blank agent')
    expect(wrapper.text()).toContain('From template')
    expect(wrapper.text()).toContain('Upload template')
  })

  it('navigates from choice -> blank and back', async () => {
    const store = useCreateAgentDialogStore()
    store.open('blank')
    await flushPromises()
    const wrapper = mount(CreateAgentDialog, { global })
    expect(wrapper.text()).toContain('New blank agent')
    expect(wrapper.text()).toContain('Description')
    expect(wrapper.text()).toContain('System prompt')

    // Click "Back" to return to the choice landing.
    const back = wrapper.findAll('button').find((b) => b.text().trim() === 'Back')
    expect(back).toBeTruthy()
    await back!.trigger('click')
    expect(store.mode).toBe('choice')
  })

  it('submits the blank form with optional description + system_prompt', async () => {
    const store = useCreateAgentDialogStore()
    store.open('blank')
    const wrapper = mount(CreateAgentDialog, { global })

    // Fill the form via the input refs in the DOM.
    const inputs = wrapper.findAll('input[type="text"]')
    const nameInput = inputs[0]!
    const descInput = inputs[1]!
    await nameInput.setValue(blankForm.name)
    await descInput.setValue(blankForm.description)
    const sysPrompt = wrapper.find('textarea')
    await sysPrompt.setValue(blankForm.system_prompt)

    // Click the primary CTA — "Create agent".
    const cta = wrapper.findAll('button').find((b) => b.text().trim() === 'Create agent')
    expect(cta).toBeTruthy()
    await cta!.trigger('click')
    await flushPromises()

    expect(createAgentMock).toHaveBeenCalledWith({
      name: blankForm.name,
      description: blankForm.description,
      system_prompt: blankForm.system_prompt,
    })
    expect(toastSuccessMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: 42 } })
  })

  it('omits description + system_prompt when blank', async () => {
    const store = useCreateAgentDialogStore()
    store.open('blank')
    const wrapper = mount(CreateAgentDialog, { global })
    const nameInput = wrapper.findAll('input[type="text"]')[0]!
    await nameInput.setValue('Just a name')

    const cta = wrapper.findAll('button').find((b) => b.text().trim() === 'Create agent')
    await cta!.trigger('click')
    await flushPromises()

    expect(createAgentMock).toHaveBeenCalledWith({
      name: 'Just a name',
      description: undefined,
      system_prompt: undefined,
    })
  })

  it('navigates from choice -> template and groups templates by source', async () => {
    // Make fetchTemplates populate the store with two templates.
    templateStoreFetchMock.mockImplementation(async () => {
      templatesRef.value = [
        { id: 'core-assistant', name: 'Core', source: 'core', description: 'd', version: '1.0.0', tools_count: 4, required_plugins: [], has_warnings: false, category: 'general', icon: 'puzzle', filename: 'core-assistant.json' },
        { id: 'weather', name: 'Weather', source: 'weather', description: 'd', version: '1.0.0', tools_count: 2, required_plugins: ['weather'], has_warnings: true, category: 'research', icon: 'sun', filename: 'weather.json' },
      ]
    })

    const wrapper = mount(CreateAgentDialog, { global })
    // Mount the dialog first (so the watch is registered), then drive
    // the store. The watch fires when mode flips to 'template'.
    const store = useCreateAgentDialogStore()
    store.open('template')
    await flushPromises()
    await flushPromises()

    expect(templateStoreFetchMock).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('Core')
    expect(text).toContain('Weather')
    // "Core" header comes before "weather" header
    expect(text.indexOf('Core')).toBeLessThan(text.indexOf('weather'))
  })

  it('navigates from choice -> upload and shows the file picker', async () => {
    const store = useCreateAgentDialogStore()
    store.open('upload')
    await flushPromises()
    const wrapper = mount(CreateAgentDialog, { global })
    expect(wrapper.text()).toContain('Choose file…')
    expect(wrapper.text()).toContain('File is read locally')
  })

  it('closes the dialog and resets to choice on the next open', async () => {
    const store = useCreateAgentDialogStore()
    store.open('blank')
    expect(store.isOpen).toBe(true)
    expect(store.mode).toBe('blank')
    store.close()
    expect(store.isOpen).toBe(false)
    expect(store.mode).toBe('choice')
  })
})