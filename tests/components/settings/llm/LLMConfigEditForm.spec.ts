/**
 * LLMConfigEditForm — edit form for an existing LLM driver configuration.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { ApiError } from '@/api/client'

const driversRef = ref<Array<{ name: string; display_name: string; driver_class: string; settings_schema: Array<{ key: string; label: string; type: string; required: boolean; default: unknown; description: string; options: unknown; expose_to_llm: boolean }> }>>([])
const updateConfigMock = vi.fn()
const deleteConfigMock = vi.fn()
const setDefaultMock = vi.fn()

vi.mock('@/stores/llmConfigs', () => ({
  useLlmConfigsStore: () => ({
    get drivers() { return driversRef.value },
    updateConfig: updateConfigMock,
    deleteConfig: deleteConfigMock,
    setDefault: setDefaultMock,
    driverForClass: (cls: string) => driversRef.value.find((d) => d.driver_class === cls),
  }),
}))

const userRef = ref<{ is_admin: boolean } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ get user() { return userRef.value } }),
}))

import LLMConfigEditForm from '@/components/settings/llm/LLMConfigEditForm.vue'

const sampleConfig = (overrides: Partial<{ id: number; name: string; driver_class: string; driver_display_name: string; is_global: boolean; settings: Record<string, string>; created_at: string; updated_at: string }> = {}) => ({
  id: 1, name: 'cfg', driver_class: 'OpenAI', driver_display_name: 'OpenAI', is_global: false,
  settings: { api_key: '***' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const sampleSchema = [{ key: 'api_key', label: 'API Key', type: 'password', required: true, default: '', description: '', options: null, expose_to_llm: false }]

beforeEach(() => {
  setActivePinia(createPinia())
  driversRef.value = [{ name: 'openai', display_name: 'OpenAI', driver_class: 'OpenAI', settings_schema: sampleSchema }]
  userRef.value = null
  updateConfigMock.mockReset()
  deleteConfigMock.mockReset()
  setDefaultMock.mockReset()
})

function mountEdit(config: ReturnType<typeof sampleConfig> = sampleConfig()) {
  return mount(LLMConfigEditForm, { props: { config }, attachTo: document.body })
}

function findDeleteButtonInModal(): HTMLButtonElement | undefined {
  const all = Array.from(document.body.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === 'Delete')
  // The page-level Delete button uses `bg-destructive/10`, the modal confirm uses `bg-destructive px-4`.
  return all.find((b) => b.className.includes('bg-destructive px-4')) as HTMLButtonElement | undefined
}

function findCancelButtonInModal(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Cancel' && b.className.includes('bg-background')) as HTMLButtonElement | undefined
}

describe('LLMConfigEditForm', () => {
  it('renders the configuration name and driver', () => {
    const wrapper = mountEdit(sampleConfig({ name: 'Production' }))
    expect(wrapper.text()).toContain('Production')
    expect(wrapper.text()).toContain('OpenAI')
  })

  it('renders the "All configurations" back button and emits cancel on click', async () => {
    const wrapper = mountEdit()
    const back = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('All configurations'))
    expect(back).toBeDefined()
    await back!.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('shows a read-only banner when the user is non-admin and config is global', () => {
    userRef.value = { is_admin: false }
    const wrapper = mountEdit(sampleConfig({ is_global: true }))
    expect(wrapper.text()).toContain('Global configuration')
  })

  it('does not show a read-only banner when the user is admin', () => {
    userRef.value = { is_admin: true }
    const wrapper = mountEdit(sampleConfig({ is_global: true }))
    expect(wrapper.text()).not.toContain('Global configuration — available to all users')
  })

  it('shows the Delete button and only opens the modal (no emit) on first click', async () => {
    const wrapper = mountEdit()
    const del = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')
    expect(del).toBeDefined()
    await del!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('deleted')).toBeFalsy()
    wrapper.unmount()
  })

  it('opens the delete confirmation modal and confirms deletion', async () => {
    deleteConfigMock.mockResolvedValue(undefined)
    const wrapper = mountEdit()
    const del = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')
    await del!.trigger('click')
    await flushPromises()
    const confirmBtn = findDeleteButtonInModal()
    expect(confirmBtn).toBeDefined()
    confirmBtn?.click()
    await flushPromises()
    expect(deleteConfigMock).toHaveBeenCalledWith(1)
    expect(wrapper.emitted('deleted')).toBeTruthy()
    wrapper.unmount()
  })

  it('cancels the delete modal when Cancel is clicked', async () => {
    const wrapper = mountEdit()
    const del = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')
    await del!.trigger('click')
    await flushPromises()
    const cancelBtn = findCancelButtonInModal()
    expect(cancelBtn).toBeDefined()
    cancelBtn?.click()
    await flushPromises()
    expect(deleteConfigMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows the read-only settings list when global and not admin', () => {
    userRef.value = { is_admin: false }
    const wrapper = mountEdit(sampleConfig({ is_global: true, settings: { api_key: '***', model: 'gpt-4' } }))
    expect(wrapper.text()).toContain('••••••••')
    expect(wrapper.text()).toContain('model')
  })

  it('renders Created/Updated metadata', () => {
    const wrapper = mountEdit(sampleConfig({ created_at: '2026-01-15T00:00:00Z', updated_at: '2026-02-20T00:00:00Z' }))
    expect(wrapper.text()).toContain('Created')
    expect(wrapper.text()).toContain('Updated')
  })

  describe('Set as Global Default', () => {
    function findPromoteButton(wrapper: ReturnType<typeof mountEdit>): ReturnType<typeof wrapper.findAll>[number] | undefined {
      return wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Set as Global Default')
    }

    it('renders the button for admin + global + non-default config', () => {
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))
      expect(findPromoteButton(wrapper)).toBeDefined()
    })

    it('hides the button for non-admin', () => {
      userRef.value = { is_admin: false }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))
      expect(findPromoteButton(wrapper)).toBeUndefined()
    })

    it('hides the button for non-global configs', () => {
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: false }))
      expect(findPromoteButton(wrapper)).toBeUndefined()
    })

    it('hides the button when the config is already the default', () => {
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: true } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))
      expect(findPromoteButton(wrapper)).toBeUndefined()
    })

    it('shows a static "Global default" pill when the config is already default', () => {
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: true } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))
      expect(wrapper.text()).toContain('Global default')
      // The pill is a span, not a button — only the Delete button is interactive in this state.
      const buttonsText = wrapper.findAll('button').map((b) => (b.text() ?? '').trim()).join('|')
      expect(buttonsText).not.toContain('Set as Global Default')
    })

    it('clicking the button calls setDefault and emits saved', async () => {
      setDefaultMock.mockResolvedValue({ id: 1, is_default: true })
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))

      await findPromoteButton(wrapper)!.trigger('click')
      await flushPromises()

      expect(setDefaultMock).toHaveBeenCalledWith(1)
      expect(wrapper.emitted('saved')).toBeTruthy()
    })

    it('renders the Promoting… label while the call is in flight', async () => {
      let resolvePromote: (v: unknown) => void = () => {}
      setDefaultMock.mockReturnValueOnce(new Promise((resolve) => { resolvePromote = resolve }))
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))

      const button = findPromoteButton(wrapper)!
      void button.trigger('click')
      await flushPromises()

      expect(button.text()).toContain('Promoting…')
      expect((button.element as HTMLButtonElement).disabled).toBe(true)

      resolvePromote({ id: 1, is_default: true })
      await flushPromises()
      wrapper.unmount()
    })

    it('surfaces an ApiError message on failure', async () => {
      setDefaultMock.mockRejectedValueOnce(new ApiError('Admin only', 'FORBIDDEN', 403))
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))

      await findPromoteButton(wrapper)!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Admin only')
      expect(wrapper.emitted('saved')).toBeFalsy()
    })

    it('falls back to a generic message on a non-ApiError rejection', async () => {
      setDefaultMock.mockRejectedValueOnce(new Error('network exploded'))
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))

      await findPromoteButton(wrapper)!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Failed to set as global default.')
    })

    it('disables the Delete button while the promote call is in flight', async () => {
      let resolvePromote: (v: unknown) => void = () => {}
      setDefaultMock.mockReturnValueOnce(new Promise((resolve) => { resolvePromote = resolve }))
      userRef.value = { is_admin: true }
      const wrapper = mountEdit(sampleConfig({ is_global: true, is_default: false } as Partial<ReturnType<typeof sampleConfig>> & { is_default?: boolean }))

      void findPromoteButton(wrapper)!.trigger('click')
      await flushPromises()

      const del = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')
      expect((del!.element as HTMLButtonElement).disabled).toBe(true)

      resolvePromote({ id: 1, is_default: true })
      await flushPromises()
      wrapper.unmount()
    })
  })

  describe('Limits fields', () => {
    it('renders the Limits section above Settings with the current values', () => {
      const wrapper = mountEdit(sampleConfig({ context_window: 200000, max_tokens_output: 32000 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }))
      expect(wrapper.text()).toContain('Limits')
      const inputs = wrapper.findAll('input[type="number"]')
      expect(inputs).toHaveLength(2)
      expect((inputs[0].element as HTMLInputElement).value).toBe('200000')
      expect((inputs[1].element as HTMLInputElement).value).toBe('32000')
    })

    it('sends context_window + max_tokens_output on save when set', async () => {
      updateConfigMock.mockResolvedValue({
        ...sampleConfig({ context_window: 200000, max_tokens_output: 32000 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }),
        settings: { api_key: '***' },
      })
      const wrapper = mountEdit(sampleConfig({ context_window: 100000, max_tokens_output: 8000 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }))
      const inputs = wrapper.findAll('input[type="number"]')
      await inputs[0].setValue('200000')
      await inputs[1].setValue('32000')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()
      expect(updateConfigMock).toHaveBeenCalled()
      expect(updateConfigMock.mock.calls[0][1]).toMatchObject({
        context_window: 200000,
        max_tokens_output: 32000,
      })
      wrapper.unmount()
    })

    it('sends undefined for blank fields (absent = unchanged)', async () => {
      updateConfigMock.mockResolvedValue(sampleConfig())
      const wrapper = mountEdit(sampleConfig({ context_window: null, max_tokens_output: null } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number | null; max_tokens_output?: number | null }))
      const inputs = wrapper.findAll('input[type="number"]')
      expect((inputs[0].element as HTMLInputElement).value).toBe('')
      expect((inputs[1].element as HTMLInputElement).value).toBe('')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()
      const payload = updateConfigMock.mock.calls[0][1]
      expect(payload.context_window).toBeUndefined()
      expect(payload.max_tokens_output).toBeUndefined()
      wrapper.unmount()
    })

    it('hides the Limits section for read-only (global + non-admin) configs', () => {
      userRef.value = { is_admin: false }
      const wrapper = mountEdit(sampleConfig({ is_global: true }))
      expect(wrapper.text()).not.toContain('Limits')
      expect(wrapper.findAll('input[type="number"]')).toHaveLength(0)
    })

    it('keeps Save disabled when neither Settings nor Limits have changed', () => {
      const wrapper = mountEdit(sampleConfig({ context_window: 128000, max_tokens_output: 16384 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }))
      const save = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Save')
      expect(save).toBeDefined()
      expect(save?.attributes('disabled')).toBeDefined()
    })

    it('enables Save when only the Max output tokens field changed', async () => {
      const wrapper = mountEdit(sampleConfig({ context_window: 128000, max_tokens_output: 16384 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }))
      const inputs = wrapper.findAll('input[type="number"]')
      await inputs[1].setValue('32000')
      await flushPromises()
      const save = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Save')
      expect(save?.attributes('disabled')).toBeUndefined()
    })

    it('enables Save when only the Context window field changed', async () => {
      const wrapper = mountEdit(sampleConfig({ context_window: 128000, max_tokens_output: 16384 } as Partial<ReturnType<typeof sampleConfig>> & { context_window?: number; max_tokens_output?: number }))
      const inputs = wrapper.findAll('input[type="number"]')
      await inputs[0].setValue('200000')
      await flushPromises()
      const save = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Save')
      expect(save?.attributes('disabled')).toBeUndefined()
    })
  })
})
