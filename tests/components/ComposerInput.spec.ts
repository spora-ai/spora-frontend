/**
 * ComposerInput — prompt composer with template selection, scheduling, and
 * task submission. Covers the schedule button, save-as-template, template
 * selection, agent info, submit error, and the template error paths.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// Ensure module-level cache in useMediaAllowedTypes doesn't leak between
// describe blocks (the cache Map lives at module scope, not inside the
// composable function).
import { clearMediaAllowedTypesCache } from '@/composables/useMediaAllowedTypes'

// vi.hoisted: variables available inside vi.mock factories (which are
// themselves hoisted to the top of the file).
const {
  routerPushMock,
  confirmMock,
  createTaskForAgentMock,
  clearComposerDraftMock,
  deleteTemplateMock,
  fetchAllTemplatesMock,
  apiMock,
} = vi.hoisted(() => {
  const routerPushMock = vi.fn()
  const confirmMock = vi.fn().mockResolvedValue(true)
  const createTaskForAgentMock = vi.fn().mockResolvedValue({ id: 99 })
  const clearComposerDraftMock = vi.fn()
  const deleteTemplateMock = vi.fn()
  const fetchAllTemplatesMock = vi.fn()
  const apiMock = { get: vi.fn(), post: vi.fn(), postForm: vi.fn(), put: vi.fn(), delete: vi.fn() }
  return {
    routerPushMock,
    confirmMock,
    createTaskForAgentMock,
    clearComposerDraftMock,
    deleteTemplateMock,
    fetchAllTemplatesMock,
    apiMock,
  }
})

// Top-level reactive state (mock factories are lazy; they run when stores
// are called, by which time the refs are initialised).
const currentAgentRef = ref<{ id: number; name: string; llm_driver_config_id: number | null; max_steps: number; tools: { name: string }[]; llm_supports_image_input?: boolean } | null>({
  id: 1,
  name: 'Test Agent',
  llm_driver_config_id: 1,
  max_steps: 5,
  llm_supports_image_input: false,
  tools: [{ name: 'web_search' }, { name: 'calculator' }, { name: 'send_email' }],
})
const llmConfigsRef = ref<Array<{ id: number; name: string }>>([
  { id: 1, name: 'GPT-4' },
  { id: 2, name: 'Claude' },
])
const preferenceRef = ref<null | { config: { name: string } }>(null)
const promptTemplatesRef = ref<Array<{ id: number; name: string; prompt_template: string; variables: string[] }>>([])
// The composer draft: the real store mutates a reactive object, so the
// mock exposes a getter/setter on a ref to preserve reactivity.
const draftTextRef = ref('')

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get currentAgent() { return currentAgentRef.value },
    getComposerDraft: () => ({
      get promptText() { return draftTextRef.value },
      set promptText(v: string) { draftTextRef.value = v },
    }),
    clearComposerDraft: clearComposerDraftMock,
  }),
}))

vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({
    get configs() { return llmConfigsRef.value },
  }),
}))

vi.mock('@/stores/llmPreferencesStore', () => ({
  useLlmPreferencesStore: () => ({
    get preference() { return preferenceRef.value },
  }),
}))

vi.mock('@/stores/promptTemplates', () => ({
  usePromptTemplatesStore: () => ({
    get templates() { return promptTemplatesRef.value },
    fetchAll: fetchAllTemplatesMock,
    deleteTemplate: deleteTemplateMock,
  }),
}))

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    createTaskForAgent: createTaskForAgentMock,
  }),
}))

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

vi.mock('@/composables/useComposerInput', () => ({
  isSubmitKeystroke: (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key === 'Enter',
  buildPromptFromTemplate: (template: string) => `rendered:${template}`,
}))

vi.mock('@/api/client', () => ({
  default: apiMock,
  api: apiMock,
  ApiError: class ApiError extends Error { status = 0 },
}))

vi.mock('@/components/shared/ScheduleEditor/index.vue', () => ({
  default: { name: 'SharedScheduleEditor', props: ['modelValue', 'agentId', 'initialData'], emits: ['update:modelValue', 'saved', 'closed'], template: '<div v-if="modelValue" data-testid="schedule-editor" />' },
}))

vi.mock('@/components/PromptTemplateDialog.vue', () => ({
  default: { name: 'PromptTemplateDialog', props: ['modelValue', 'agentId', 'initialPrompt', 'existingTemplateId'], emits: ['update:modelValue', 'saved'], template: '<div v-if="modelValue" data-testid="template-dialog" />' },
}))

const IconStub = {
  name: 'Icon',
  props: ['name'],
  template: '<span class="icon-stub" :data-name="name" />',
}

import ComposerInput from '@/components/ComposerInput.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'

const findSubmitButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((b) => b.classes().includes('rounded-full') && b.classes().includes('bg-primary'))!

const findByText = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text)!

// Helpers for the MarkdownEditor mock (contenteditable surface). The mock
// listens to 'input' events on its `.md-editor-input` div and emits
// `update:modelValue` with the current innerText.
const findPromptInput = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('[contenteditable]')

const getPromptValue = (wrapper: ReturnType<typeof mount>): string =>
  (findPromptInput(wrapper).element as HTMLElement).innerText ?? ''

const setPromptValue = async (wrapper: ReturnType<typeof mount>, value: string) => {
  const input = findPromptInput(wrapper)
  ;(input.element as HTMLElement).innerText = value
  await input.trigger('input')
}

const isPromptDisabled = (wrapper: ReturnType<typeof mount>): boolean =>
  (findPromptInput(wrapper).element as HTMLElement).getAttribute('contenteditable') === 'false'

beforeEach(() => {
  setActivePinia(createPinia())
  currentAgentRef.value = {
    id: 1,
    name: 'Test Agent',
    llm_driver_config_id: 1,
    max_steps: 5,
    llm_supports_image_input: false,
    tools: [{ name: 'web_search' }, { name: 'calculator' }, { name: 'send_email' }],
  }
  llmConfigsRef.value = [
    { id: 1, name: 'GPT-4' },
    { id: 2, name: 'Claude' },
  ]
  preferenceRef.value = null
  promptTemplatesRef.value = []
  draftTextRef.value = ''
  routerPushMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
  createTaskForAgentMock.mockReset()
  createTaskForAgentMock.mockResolvedValue({ id: 99 })
  clearComposerDraftMock.mockReset()
  deleteTemplateMock.mockReset()
  fetchAllTemplatesMock.mockReset()
})

describe('ComposerInput', () => {
  it('renders a textarea with the default placeholder', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(findPromptInput(wrapper).exists()).toBe(true)
    expect(findPromptInput(wrapper).attributes('data-placeholder')).toBeTruthy()
  })

  it('enables auto-grow on the MarkdownEditor and caps at 15 rows', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    const editor = wrapper.findComponent(MarkdownEditor)
    expect(editor.exists()).toBe(true)
    expect(editor.props('autoGrow')).toBe(true)
    expect(editor.props('maxRows')).toBe(15)
    expect(editor.props('rows')).toBe(2)
  })

  it('renders the current LLM config name from the configs store', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).toContain('GPT-4')
  })

  it('falls back to "Custom LLM config" when no config matches', () => {
    currentAgentRef.value = { ...currentAgentRef.value!, llm_driver_config_id: 999 }
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).toContain('Custom LLM config')
  })

  it('renders the preferred config name when no agent config is set', () => {
    currentAgentRef.value = { ...currentAgentRef.value!, llm_driver_config_id: null }
    preferenceRef.value = { config: { name: 'Claude-Opus' } }
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).toContain('Claude-Opus')
    expect(wrapper.text()).toContain('(preferred)')
  })

  it('renders "Global default" when neither agent nor preference is set', () => {
    currentAgentRef.value = { ...currentAgentRef.value!, llm_driver_config_id: null }
    preferenceRef.value = null
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).toContain('Global default')
  })

  it('renders the tool count and max-steps in the agent info row', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).toContain('3 tools')
    expect(wrapper.text()).toContain('Max 5 steps')
  })

  it('does not render the agent info row when there is no current agent', () => {
    currentAgentRef.value = null
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.text()).not.toContain('Max 5 steps')
  })

  it('disables the submit button when the prompt is empty', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    const submitBtn = findSubmitButton(wrapper)
    expect(submitBtn.attributes('disabled')).toBeDefined()
  })

  it('submits a task when the user clicks the send button', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'hello')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(createTaskForAgentMock).toHaveBeenCalledWith(1, 'hello', undefined, [])
    expect(clearComposerDraftMock).toHaveBeenCalledWith(1)
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'task', params: { id: 99 } })
  })

  it('submits a task on Cmd+Enter / Ctrl+Enter', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'via shortcut')
    await findPromptInput(wrapper).trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()
    expect(createTaskForAgentMock).toHaveBeenCalledWith(1, 'via shortcut', undefined, [])
  })

  it('does not submit on plain Enter (no modifier)', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'test')
    await findPromptInput(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(createTaskForAgentMock).not.toHaveBeenCalled()
  })

  it('does not submit when the prompt is empty after trim', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'   ')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(createTaskForAgentMock).not.toHaveBeenCalled()
  })


  it('surfaces a submit error when the task creation fails', async () => {
    createTaskForAgentMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'will fail')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to start task.')
  })

  it('opens the schedule editor when the Schedule button is clicked', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    const scheduleBtn = findByText(wrapper, 'Schedule')
    await scheduleBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="schedule-editor"]').exists()).toBe(true)
  })

  it('renders the template selector when templates exist', () => {
    promptTemplatesRef.value = [
      { id: 1, name: 'Greet', prompt_template: 'Hello', variables: [] },
    ]
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    expect(wrapper.find('select').exists()).toBe(true)
    expect(wrapper.text()).toContain('Greet')
  })

  it('selecting a template sets the prompt text', async () => {
    promptTemplatesRef.value = [
      { id: 1, name: 'Greet', prompt_template: 'Hello {{name}}', variables: ['name'] },
    ]
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    const select = wrapper.find('select')
    await select.setValue('1')
    await flushPromises()
    expect(getPromptValue(wrapper)).toBe('rendered:Hello {{name}}')
  })

  it('deleting the selected template confirms and calls deleteTemplate', async () => {
    promptTemplatesRef.value = [
      { id: 1, name: 'Greet', prompt_template: 'Hello', variables: [] },
    ]
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await wrapper.find('select').setValue('1')
    await flushPromises()
    const deleteBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Delete template')!
    await deleteBtn.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalled()
    expect(deleteTemplateMock).toHaveBeenCalledWith(1, 1)
  })

  it('shows the Save-as-template button when there is prompt text', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'Save this prompt')
    await flushPromises()
    const saveBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Save prompt as template')
    expect(saveBtn).toBeDefined()
  })

  it('disables the textarea while submitting', async () => {
    let resolveCreate: (v: { id: number }) => void
    createTaskForAgentMock.mockReturnValue(new Promise((r) => { resolveCreate = r }))
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'go')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await nextTick()
    expect(isPromptDisabled(wrapper)).toBe(true)
    resolveCreate!({ id: 1 })
    await flushPromises()
  })

  it('respects the `disabled` prop', () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1, disabled: true },
      global: { stubs: { Icon: IconStub } },
    })
    expect(isPromptDisabled(wrapper)).toBe(true)
  })

  it('clicks the agent info buttons and pushes the agent-settings route', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 42 },
      global: { stubs: { Icon: IconStub } },
    })
        const settingsBtns = wrapper.findAll('button').filter((b) => b.attributes('title') === 'Go to agent settings')
    const toolsBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Go to agent tools')!
    await settingsBtns[0].trigger('click')
    await toolsBtn.trigger('click')
    await settingsBtns[1].trigger('click')
    expect(routerPushMock).toHaveBeenCalledTimes(3)
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'agent-settings', params: { id: 42 } })
  })

  it('opens the save-as-template dialog when the Save button is clicked', async () => {
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'save me')
    await flushPromises()
    const saveBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Save prompt as template')!
    await saveBtn.trigger('click')
    await nextTick()
        expect(wrapper.find('[data-testid="template-dialog"]').exists()).toBe(true)
  })

  it('fires the SharedScheduleEditor @saved event to call onScheduleSaved', async () => {
    const SharedScheduleEditor = (await import('@/components/shared/ScheduleEditor/index.vue')).default
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await setPromptValue(wrapper,'to schedule')
    await flushPromises()
        const scheduleBtn = findByText(wrapper, 'Schedule')
    await scheduleBtn.trigger('click')
    await nextTick()
        const editor = wrapper.findComponent(SharedScheduleEditor)
    expect(editor.exists()).toBe(true)
    editor.vm.$emit('saved')
    await flushPromises()
        expect(getPromptValue(wrapper)).toBe('')
  })
})

describe('ComposerInput media attachments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearMediaAllowedTypesCache()
    currentAgentRef.value = {
      id: 1,
      name: 'Test Agent',
      llm_driver_config_id: 1,
      max_steps: 5,
      llm_supports_image_input: false,
      tools: [{ name: 'web_search' }, { name: 'calculator' }, { name: 'send_email' }],
    }
    llmConfigsRef.value = [
      { id: 1, name: 'GPT-4' },
      { id: 2, name: 'Claude' },
    ]
    preferenceRef.value = null
    promptTemplatesRef.value = []
    draftTextRef.value = ''
    routerPushMock.mockReset()
    confirmMock.mockReset()
    confirmMock.mockResolvedValue(true)
    createTaskForAgentMock.mockReset()
    createTaskForAgentMock.mockResolvedValue({ id: 99 })
    clearComposerDraftMock.mockReset()
    deleteTemplateMock.mockReset()
    fetchAllTemplatesMock.mockReset()
    apiMock.get.mockReset()
    apiMock.postForm.mockReset()
    apiMock.post.mockReset()
    apiMock.put.mockReset()
    apiMock.delete.mockReset()
  })

  it('loads the allowlist on mount and renders the accept attribute', async () => {
    apiMock.get.mockResolvedValueOnce({
      mime_types: ['text/plain', 'application/pdf'],
      extensions: ['txt', 'pdf'],
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    expect(apiMock.get).toHaveBeenCalledWith('/media/allowed-types?agent_id=1')
    const fileInput = wrapper.find('input[type="file"]')
    expect(fileInput.attributes('accept')).toBe('.txt,.pdf')
  })

  it('swallows errors from the allowlist probe', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('network down'))
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
  })

  it('disables the image button when the LLM does not support images', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const imageBtn = findByText(wrapper, 'Attach image')
    expect(imageBtn.attributes('disabled')).toBeDefined()
    expect(imageBtn.attributes('title')).toContain('does not support image attachments')
  })

  it('enables the image button when the LLM supports images', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    currentAgentRef.value = { ...currentAgentRef.value!, llm_supports_image_input: true }
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const imageBtn = findByText(wrapper, 'Attach image')
    expect(imageBtn.attributes('disabled')).toBeUndefined()
    expect(imageBtn.attributes('title')).toBe('Attach an image')
  })

  it('uploads files via postForm and renders chips for each asset', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockResolvedValueOnce({
      id: 'asset-1',
      filename: 'note.txt',
      media_type: 'document',
      mime_type: 'text/plain',
      byte_size: 42,
      asset_url: null,
      has_markdown: true,
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(apiMock.postForm).toHaveBeenCalledTimes(1)
    const [path, form] = apiMock.postForm.mock.calls[0]
    expect(path).toBe('/media')
    expect(form.get('file')).toBe(file)
    expect(form.get('agent_id')).toBe('1')
    expect(wrapper.text()).toContain('note.txt')
  })

  it('removes an attachment chip when the X button is clicked', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockResolvedValueOnce({
      id: 'asset-2',
      filename: 'note.txt',
      media_type: 'document',
      mime_type: 'text/plain',
      byte_size: 42,
      asset_url: null,
      has_markdown: true,
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('note.txt')
    const removeBtn = wrapper.findAll('button').find((b) => b.attributes('title') === 'Remove attachment')!
    await removeBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('note.txt')
  })

  it('surfaces the upload error when postForm throws', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('Upload failed.')
  })

  it('surfaces an ApiError message verbatim', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    // The component checks `e instanceof ApiError` from `@/api/client`.
    // The mock for that module returns a class with name="ApiError" but
    // not a real class identity, so the component falls through to the
    // generic "Upload failed." message. Use a real instance instead.
    const { ApiError } = await import('@/api/client')
    const err = new ApiError('Upload failed (HTTP 413)', 'UPLOAD_FAILED', 413)
    apiMock.postForm.mockRejectedValueOnce(err)
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('Upload failed (HTTP 413)')
  })

  it('blocks submission when an image asset is attached and the LLM lacks vision', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockResolvedValueOnce({
      id: 'asset-img',
      filename: 'pic.png',
      media_type: 'image',
      mime_type: 'image/png',
      byte_size: 1024,
      asset_url: '/api/v1/assets/x.png',
      has_markdown: false,
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    await setPromptValue(wrapper, 'describe this')
    await flushPromises()
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(createTaskForAgentMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('does not support image attachments')
  })

  it('clears attached chips after a successful submission', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockResolvedValueOnce({
      id: 'asset-3',
      filename: 'note.txt',
      media_type: 'document',
      mime_type: 'text/plain',
      byte_size: 42,
      asset_url: null,
      has_markdown: true,
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['x'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    await setPromptValue(wrapper, 'sum it up')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(createTaskForAgentMock).toHaveBeenCalledWith(1, 'sum it up', undefined, ['asset-3'])
    expect(wrapper.text()).not.toContain('note.txt')
  })

  it('keeps attached chips when the submission fails', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    apiMock.postForm.mockResolvedValueOnce({
      id: 'asset-4',
      filename: 'note.txt',
      media_type: 'document',
      mime_type: 'text/plain',
      byte_size: 42,
      asset_url: null,
      has_markdown: true,
    })
    createTaskForAgentMock.mockRejectedValueOnce(new Error('submit failed'))
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const file = new File(['x'], 'note.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    await setPromptValue(wrapper, 'sum it up')
    const submitBtn = findSubmitButton(wrapper)
    await submitBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('note.txt')
  })

  it('hides attachment chips when none are attached', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.findAll('[title="Remove attachment"]').length).toBe(0)
  })

  it('renders the Allowed legend when the allowlist returns extensions', async () => {
    apiMock.get.mockResolvedValueOnce({
      mime_types: ['text/plain', 'application/pdf'],
      extensions: ['txt', 'pdf'],
    })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Allowed:')
  })

  it('hides the Allowed legend when no extensions are returned', async () => {
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const allowLegend = wrapper.find('span.text-muted-foreground\\/70')
    expect(allowLegend.exists() ? allowLegend.text() : '').not.toContain('Allowed:')
  })

  it('hides the attach affordance when the LLM does support images (tooltip clear)', async () => {
    currentAgentRef.value = { ...currentAgentRef.value!, llm_supports_image_input: true }
    apiMock.get.mockResolvedValueOnce({ mime_types: [], extensions: [] })
    const wrapper = mount(ComposerInput, {
      props: { agentId: 1 },
      global: { stubs: { Icon: IconStub } },
    })
    await flushPromises()
    const attachBtn = findByText(wrapper, 'Attach file')
    expect(attachBtn.attributes('title')).toBe('Attach a file')
  })
})
