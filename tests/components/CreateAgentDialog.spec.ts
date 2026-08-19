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
const groupsRef = ref<Array<{ id: number; name: string; principal_id: number | null }>>([])
const groupsStoreFetchMock = vi.fn()

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

vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get groups() { return groupsRef.value },
    fetchGroups: groupsStoreFetchMock,
  }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 1, email: 'alice@example.com' },
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
  groupsStoreFetchMock.mockReset()
  groupsStoreFetchMock.mockResolvedValue(undefined)
  groupsRef.value = []
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
      principal_id: null,
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
      principal_id: null,
    })
  })

  it('passes principal_id when the user picks a group as the owner', async () => {
    groupsRef.value = [
      { id: 1, name: 'Research Team', principal_id: 7 },
      { id: 2, name: 'Operations', principal_id: 9 },
    ]
    const store = useCreateAgentDialogStore()
    store.open('blank')
    const wrapper = mount(CreateAgentDialog, { global })
    await flushPromises()

    const nameInput = wrapper.findAll('input[type="text"]')[0]!
    await nameInput.setValue('Group Agent')

    const ownerSelect = wrapper.find('select')!
    const options = ownerSelect.findAll('option')
    expect(options.length).toBe(3) // Myself + 2 groups
    expect(options[0]!.text()).toContain('Myself')
    expect(options[1]!.text()).toBe('Research Team')
    expect(options[2]!.text()).toBe('Operations')
    await ownerSelect.setValue('9') // Operations

    const cta = wrapper.findAll('button').find((b) => b.text().trim() === 'Create agent')
    await cta!.trigger('click')
    await flushPromises()

    expect(createAgentMock).toHaveBeenCalledWith({
      name: 'Group Agent',
      description: undefined,
      system_prompt: undefined,
      principal_id: 9,
    })
  })

  it('resets principal_id when the dialog re-opens', async () => {
    groupsRef.value = [{ id: 2, name: 'Operations', principal_id: 9 }]
    const store = useCreateAgentDialogStore()
    store.open('blank')
    let wrapper = mount(CreateAgentDialog, { global })
    await flushPromises()
    await wrapper.find('select')!.setValue('9')
    store.close()
    await flushPromises()

    store.open('blank')
    wrapper = mount(CreateAgentDialog, { global })
    await flushPromises()
    // Vue serialises the `null` owner back to the empty string in the
    // select element; the point is just that it's no longer '9'.
    const select = wrapper.find('select')!.element as HTMLSelectElement
    // After re-open the owner should be the default 'Myself' option,
    // NOT 'Operations'. Vue serialises a `:value="null"` binding to
    // the option text, so we compare against that.
    expect(select.value).not.toBe('9')
    expect(select.selectedIndex).toBe(0)
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

  it('renders warnings in the preview state and runs import on confirm', async () => {
    // Make fetchTemplates populate the store with one Weather template
    // so the gallery card is rendered.
    templateStoreFetchMock.mockImplementation(async () => {
      templatesRef.value = [
        { id: 'weather', name: 'Weather Helper', source: 'core', description: 'd', version: '1.0.0', tools_count: 2, required_plugins: ['weather'], has_warnings: true, category: 'research', icon: 'sun', filename: 'weather.json' },
      ]
    })
    templateStoreGetMock.mockResolvedValue({
      template: {
        $schema: 'https://spora.dev/agent-template.schema.json',
        id: 'weather',
        name: 'Weather Helper',
        version: '1.0.0',
        agent: { max_steps: 5, system_prompt: 'x' },
        tools: [],
        required_plugins: [],
        metadata: { category: 'general', icon: 'puzzle' },
      },
      warnings: [],
      source: 'core',
      filename: 'weather.json',
    })
    templateStoreValidateMock.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [
        { code: 'PLUGIN_MISSING', severity: 'warning', message: "Plugin 'weather' is required but not installed." },
      ],
    })
    templateStoreImportMock.mockResolvedValue({
      agent: { id: 9, name: 'Weather Helper', description: null, system_prompt: null, llm_driver_config_id: null, max_steps: 5, is_active: true, allow_followup: true, retry_after_minutes: 0, max_retries: 0 },
      warnings: [],
      tools_enabled: [],
    })

    const store = useCreateAgentDialogStore()
    const wrapper = mount(CreateAgentDialog, { global })
    store.open('template')
    await flushPromises()
    await flushPromises()

    // Click the template card to enter the preview step.
    const card = wrapper.findAll('button').find((b) => b.text().includes('Weather'))
    expect(card).toBeTruthy()
    await card!.trigger('click')
    await flushPromises()
    await flushPromises()

    // We should now be in the preview state with the warning visible.
    expect(wrapper.text()).toContain("Plugin 'weather'")
    expect(wrapper.text()).toContain('Import anyway')

    // Click the primary CTA to confirm the import.
    const importAnyway = wrapper.findAll('button').find((b) => b.text().trim() === 'Import anyway')
    await importAnyway!.trigger('click')
    await flushPromises()

    expect(templateStoreImportMock).toHaveBeenCalled()
    expect(toastSuccessMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: 9 } })
  })

  it('shows a clean preview when the template has no warnings', async () => {
    // Mirror the warnings-preview flow: populate the store with one
    // template so a card is rendered, mock getTemplate + validatePayload
    // to return a no-warnings result, and click the card.
    templateStoreFetchMock.mockImplementation(async () => {
      templatesRef.value = [
        { id: 'ok', name: 'OK Helper', source: 'core', description: 'd', version: '1.0.0', tools_count: 0, required_plugins: [], has_warnings: false, category: 'general', icon: 'puzzle', filename: 'ok.json' },
      ]
    })
    templateStoreGetMock.mockResolvedValue({
      template: { id: 'ok', name: 'OK Helper', version: '1.0.0', agent: { max_steps: 5 }, tools: [], required_plugins: [], metadata: { category: 'general', icon: 'puzzle' } },
      warnings: [],
      source: 'core',
      filename: 'ok.json',
    })
    templateStoreValidateMock.mockResolvedValue({ valid: true, errors: [], warnings: [] })

    const store = useCreateAgentDialogStore()
    const wrapper = mount(CreateAgentDialog, { global })
    store.open('template')
    await flushPromises()
    await flushPromises()

    // Click the template card to enter the preview step.
    const card = wrapper.findAll('button').find((b) => b.text().includes('OK'))
    expect(card).toBeTruthy()
    await card!.trigger('click')
    await flushPromises()
    await flushPromises()

    // No-warnings branch renders the green "Ready to import" card and
    // the footer button reads "Import" (not "Import anyway").
    expect(wrapper.text()).toContain('Ready to import')
    expect(wrapper.text()).not.toContain('Import anyway')

    const importBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Import')
    expect(importBtn).toBeTruthy()

    // Sanity: store is still open and the dialog is in preview mode.
    expect(store.isOpen).toBe(true)
    expect(store.mode).toBe('preview')
  })
})