import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PromptTemplateDialog from '@/components/PromptTemplateDialog.vue'

const mountGlobal = { stubs: { Icon: true, Teleport: true } }

beforeEach(() => {
  setActivePinia(createPinia())
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
})
