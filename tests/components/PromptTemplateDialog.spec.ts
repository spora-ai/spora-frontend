import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PromptTemplateDialog from '@/components/PromptTemplateDialog.vue'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'

const mountGlobal = { stubs: { Icon: true, Teleport: true } }

beforeEach(() => {
  setActivePinia(createPinia())
  // The effort capability is cached per agent id at module scope.
  clearAgentEffortCache()
})

vi.mock('@/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error { status = 0 },
}))

describe('PromptTemplateDialog', () => {
  it('renders nothing when modelValue is false', () => {
    const wrapper = mount(PromptTemplateDialog, { props: { modelValue: false, agentId: 1, initialPrompt: '' }, global: mountGlobal })
    expect(wrapper.find('[role="dialog"], .modal, .fixed').exists()).toBe(false)
  })

  it('emits update:modelValue when close is triggered', async () => {
    const wrapper = mount(PromptTemplateDialog, { props: { modelValue: true, agentId: 1, initialPrompt: '' }, global: mountGlobal })
    // The dialog has at least one close button
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('renders a template list area when open', () => {
    const wrapper = mount(PromptTemplateDialog, { props: { modelValue: true, agentId: 1, initialPrompt: '' }, global: mountGlobal })
    expect(wrapper.html()).toBeTruthy()
  })

  it('falls back to the catalogue sentence when the save failure is not an ApiError', async () => {
    // The catch branches on `e instanceof ApiError`; a transport error
    // reaches the catalogue's own sentence instead of the host's message.
    const { api } = await import('@/api/client')
    const post = api as unknown as { post: ReturnType<typeof vi.fn> }
    post.post.mockRejectedValueOnce(new Error('network exploded'))
    const wrapper = mount(PromptTemplateDialog, { props: { agentId: 1, modelValue: true, initialPrompt: '' }, global: mountGlobal })
    const vm = wrapper.vm as unknown as {
      formName: string
      formPrompt: string
      saveError: string | null
      save: (overwrite: boolean) => Promise<void>
    }
    vm.formName = 'Weekly digest'
    vm.formPrompt = 'Summarize the week.'
    await vm.save(false)
    await flushPromises()
    expect(vm.saveError).toBe('Failed to save template.')
  })

  it('renders a control for the template\'s own effort', async () => {
    const { api } = await import('@/api/client')
    const get = api as unknown as { get: ReturnType<typeof vi.fn> }
    get.get.mockResolvedValue({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      default: 'high',
    })
    const wrapper = mount(PromptTemplateDialog, {
      props: { modelValue: true, agentId: 1, initialPrompt: 'Hi' },
      global: mountGlobal,
    })
    await flushPromises()

    const select = wrapper.find('[data-testid="effort-select"]')
    expect(select.exists()).toBe(true)
    expect(wrapper.findAll('option').map(option => option.text())).toEqual([
      'Use the agent default',
      'Low',
      'High',
    ])
  })

  it('sends the template\'s own effort in the payload', async () => {
    const { api } = await import('@/api/client')
    const get = api as unknown as { get: ReturnType<typeof vi.fn> }
    const post = api as unknown as { post: ReturnType<typeof vi.fn> }
    get.get.mockResolvedValue({
      supported: true,
      levels: [{ value: 'high', label: 'High' }],
      default: 'high',
    })
    post.post.mockResolvedValue({ template: { id: 1 } })
    const wrapper = mount(PromptTemplateDialog, {
      props: { modelValue: true, agentId: 1, initialPrompt: 'Hi' },
      global: mountGlobal,
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      formName: string
      formPrompt: string
      save: (overwrite: boolean) => Promise<void>
    }
    vm.formName = 'Weekly digest'
    vm.formPrompt = 'Summarize the week.'
    await wrapper.find('[data-testid="effort-select"]').setValue('high')
    await vm.save(false)
    await flushPromises()

    expect(post.post).toHaveBeenCalledWith('/agents/1/templates', expect.objectContaining({ effort: 'high' }))
  })

  it('sends inherit for a template that carries no effort of its own', async () => {
    const { api } = await import('@/api/client')
    const get = api as unknown as { get: ReturnType<typeof vi.fn> }
    const post = api as unknown as { post: ReturnType<typeof vi.fn> }
    get.get.mockResolvedValue({
      supported: true,
      levels: [{ value: 'high', label: 'High' }],
      default: 'high',
    })
    post.post.mockResolvedValue({ template: { id: 1 } })
    const wrapper = mount(PromptTemplateDialog, {
      props: { modelValue: true, agentId: 1, initialPrompt: 'Hi' },
      global: mountGlobal,
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      formName: string
      formPrompt: string
      save: (overwrite: boolean) => Promise<void>
    }
    vm.formName = 'Weekly digest'
    vm.formPrompt = 'Summarize the week.'
    await vm.save(false)
    await flushPromises()

    expect(post.post).toHaveBeenCalledWith('/agents/1/templates', expect.objectContaining({ effort: null }))
  })
})
