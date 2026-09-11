/**
 * SpeechProviderConfigForm — schema-driven settings form for a single
 * speech provider configuration.
 *
 * Mounts the form against a provider schema with one of each field
 * type (text, password, textarea, select, toggle) and exercises the
 * password "***" sentinel, validation, and submit + delete flows.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const storeUpdateMock = vi.fn()
const storeRemoveMock = vi.fn()
const storeUpsertMock = vi.fn()
const putSettingsMock = vi.fn()

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
}))

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    update: storeUpdateMock,
    remove: storeRemoveMock,
    upsert: storeUpsertMock,
  }),
}))

vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => ({
    getSettings: vi.fn(),
    putSettings: putSettingsMock,
    deleteSettings: vi.fn(),
    getRawOverride: vi.fn(),
    getSettingsWithSource: vi.fn(),
    getUserSettings: vi.fn(),
    putUserSettings: vi.fn(),
    getGlobalSettings: vi.fn(),
    deleteUserSettings: vi.fn(),
    getToolStatus: vi.fn(),
    getAllToolStatuses: vi.fn(),
  }),
}))

vi.mock('@/components/ui/Icon.vue', () => ({
  default: { name: 'Icon', template: '<span data-testid="icon" />' },
}))

import SpeechProviderConfigForm from '@/components/settings/speech/SpeechProviderConfigForm.vue'

const provider = {
  class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
  display_name: 'OpenAI Compatible',
  settings_schema: [
    { key: 'display_name', label: 'Display name', type: 'text', required: true },
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true, default: 'whisper-1' },
    { key: 'base_url', label: 'Base URL', type: 'text', required: true, default: 'https://api.openai.com/v1', validation: '^https?://[^\\s]+$' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'language', label: 'Language', type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'fr', label: 'French' }] },
    { key: 'enabled', label: 'Enabled', type: 'toggle', default: 'true' },
  ],
}

const existingConfig = {
  id: 7,
  provider_class: provider.class,
  provider_display_name: 'OpenAI Compatible',
  scope: 'user' as const,
  display_name: 'Personal Mistral',
  settings: {
    display_name: 'Personal Mistral',
    api_key: '***',
    model: 'voxtral-mini-latest',
    base_url: 'https://api.mistral.ai/v1',
    notes: '',
    language: 'en',
    enabled: 'true',
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  storeUpdateMock.mockReset()
  storeRemoveMock.mockReset()
  storeUpsertMock.mockReset()
})

function mountEdit(props: { config?: typeof existingConfig | null; scope?: 'user' | 'global' } = {}) {
  return mount(SpeechProviderConfigForm, {
    props: {
      provider,
      config: props.config === undefined ? existingConfig : props.config,
      scope: props.scope ?? 'user',
    },
    attachTo: document.body,
  })
}

function findDeleteButtonInModal(): HTMLButtonElement | undefined {
  const all = Array.from(document.body.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === 'Delete')
  return all.find((b) => b.className.includes('bg-destructive px-4')) as HTMLButtonElement | undefined
}

describe('SpeechProviderConfigForm', () => {
  it('renders a field for every entry in the schema', () => {
    const wrapper = mountEdit()
    for (const field of provider.settings_schema) {
      // Passwords with a masked server value render a locked display +
      // Change button rather than an input — handled in a separate test.
      if (field.type === 'password') continue
      const input = wrapper.find(`#speech-${field.key}`)
      expect(input.exists(), `expected input for ${field.key}`).toBe(true)
    }
  })

  it('seeds the form with the existing config settings', () => {
    const wrapper = mountEdit()
    const model = wrapper.find('#speech-model')
    expect((model.element as HTMLInputElement).value).toBe('voxtral-mini-latest')
    const baseUrl = wrapper.find('#speech-base_url')
    expect((baseUrl.element as HTMLInputElement).value).toBe('https://api.mistral.ai/v1')
  })

  it('renders the locked password display when api_key is "***" and a Change button', () => {
    const wrapper = mountEdit()
    // The api_key field should NOT render an input — only the locked display + Change
    expect(wrapper.find('#speech-api_key').exists()).toBe(false)
    expect(wrapper.text()).toContain('Change')
  })

  it('clicking Change reveals the password input and clears the masked value', async () => {
    const wrapper = mountEdit()
    const changeBtn = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Change')!
    await changeBtn.trigger('click')
    const input = wrapper.find('#speech-api_key')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('omits "***" passwords from the update payload when the field is untouched', async () => {
    storeUpdateMock.mockResolvedValueOnce({
      ...existingConfig,
      settings: { ...existingConfig.settings, model: 'whisper-1' },
    })
    const wrapper = mountEdit()
    // Change the model (not the password)
    const modelInput = wrapper.find('#speech-model')
    await modelInput.setValue('whisper-1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpdateMock).toHaveBeenCalledTimes(1)
    expect(storeUpdateMock.mock.calls[0][0]).toBe(7)
    const payload = storeUpdateMock.mock.calls[0][1]
    expect(payload.settings).not.toHaveProperty('api_key')
    expect(payload.settings.model).toBe('whisper-1')
  })

  it('includes the new password value when the user changes it', async () => {
    storeUpdateMock.mockResolvedValueOnce(existingConfig)
    const wrapper = mountEdit({ config: { ...existingConfig, settings: { ...existingConfig.settings, api_key: '***' } } })
    // Click Change to reveal the input
    const changeBtn = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Change')!
    await changeBtn.trigger('click')
    await flushPromises()
    const pwInput = wrapper.find('#speech-api_key')
    expect(pwInput.exists(), 'expected password input after clicking Change').toBe(true)
    await pwInput.setValue('sk-new-key')
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpdateMock).toHaveBeenCalled()
    const payload = storeUpdateMock.mock.calls[0][1]
    expect(payload.settings.api_key).toBe('sk-new-key')
  })

  it('surfaces an inline validation error when base_url does not match the schema regex', async () => {
    const wrapper = mountEdit()
    const baseUrl = wrapper.find('#speech-base_url')
    await baseUrl.setValue('not-a-url')
    await baseUrl.trigger('blur')
    await flushPromises()
    expect(wrapper.text()).toContain('Base URL is not in the expected format.')
  })

  it('surfaces an inline error for missing required fields on submit', async () => {
    storeUpdateMock.mockReset()
    const wrapper = mountEdit({ config: { ...existingConfig, settings: { ...existingConfig.settings, display_name: '' } } })
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('Display name is required.')
    expect(storeUpdateMock).not.toHaveBeenCalled()
  })

  it('calls upsert() with scope=user when no config is bound (create mode)', async () => {
    storeUpsertMock.mockResolvedValueOnce({ ...existingConfig, id: 99 })
    const wrapper = mountEdit({ config: null, scope: 'user' })
    await wrapper.find('#speech-display_name').setValue('Fresh')
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpsertMock).toHaveBeenCalledTimes(1)
    expect(storeUpsertMock.mock.calls[0][0]).toMatchObject({
      provider_class: provider.class,
      scope: 'user',
    })
    expect(storeUpsertMock.mock.calls[0][0].settings.api_key).toBe('sk-x')
  })

  it('emits saved with the new config when upsert succeeds', async () => {
    const created = { ...existingConfig, id: 99 }
    storeUpsertMock.mockResolvedValueOnce(created)
    const wrapper = mountEdit({ config: null, scope: 'user' })
    await wrapper.find('#speech-display_name').setValue('Fresh')
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('saved')![0][0]).toMatchObject({ id: 99 })
  })

  it('renders the textarea and select widgets with the right element type', () => {
    const wrapper = mountEdit()
    expect(wrapper.find('textarea#speech-notes').exists()).toBe(true)
    expect(wrapper.find('select#speech-language').exists()).toBe(true)
    const languageOptions = wrapper.findAll('select#speech-language option')
    expect(languageOptions.length).toBeGreaterThanOrEqual(3) // None + en + fr
  })

  it('renders a toggle (checkbox) for toggle fields', () => {
    const wrapper = mountEdit()
    const toggle = wrapper.find('#speech-enabled')
    expect(toggle.exists()).toBe(true)
    expect(toggle.element.tagName).toBe('INPUT')
    expect((toggle.element as HTMLInputElement).type).toBe('checkbox')
  })

  it('emits cancel when the back button is clicked', async () => {
    const wrapper = mountEdit()
    const back = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('All configurations'))!
    await back.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('opens the delete confirmation modal when Delete is clicked', async () => {
    const wrapper = mountEdit()
    const delBtn = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')!
    await delBtn.trigger('click')
    await flushPromises()
    // The modal teleports to body — query the document directly.
    expect(document.body.textContent).toContain('This cannot be undone')
    expect(wrapper.emitted('deleted')).toBeFalsy()
    wrapper.unmount()
  })

  it('emits deleted after the operator confirms the delete', async () => {
    storeRemoveMock.mockResolvedValueOnce(undefined)
    const wrapper = mountEdit()
    const delBtn = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Delete')!
    await delBtn.trigger('click')
    await flushPromises()
    const confirmBtn = findDeleteButtonInModal()
    expect(confirmBtn).toBeDefined()
    confirmBtn?.click()
    await flushPromises()
    expect(storeRemoveMock).toHaveBeenCalledWith(7)
    expect(wrapper.emitted('deleted')).toBeTruthy()
    wrapper.unmount()
  })

  it('disables the Save button when the form is pristine', () => {
    const wrapper = mountEdit()
    const saveBtn = wrapper.find('button[type="submit"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  it('enables the Save button when a field is changed', async () => {
    const wrapper = mountEdit()
    const modelInput = wrapper.find('#speech-model')
    await modelInput.setValue('whisper-large-v3')
    await flushPromises()
    const saveBtn = wrapper.find('button[type="submit"]')
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })
})

describe('SpeechProviderConfigForm — scope: group', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpdateMock.mockReset()
    storeRemoveMock.mockReset()
    storeUpsertMock.mockReset()
  })

  it('forwards group_id on the upsert payload when scope is group', async () => {
    storeUpsertMock.mockResolvedValueOnce({ ...existingConfig, id: 99, scope: 'group' })
    const wrapper = mount(SpeechProviderConfigForm, {
      props: { provider, config: null, scope: 'group', groupId: 7 },
      attachTo: document.body,
    })
    await wrapper.find('#speech-display_name').setValue('Team Mistral')
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpsertMock).toHaveBeenCalledTimes(1)
    expect(storeUpsertMock.mock.calls[0][0]).toMatchObject({
      provider_class: provider.class,
      scope: 'group',
      group_id: 7,
    })
    wrapper.unmount()
  })
})

describe('SpeechProviderConfigForm — scope: agent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpdateMock.mockReset()
    storeRemoveMock.mockReset()
    storeUpsertMock.mockReset()
    putSettingsMock.mockReset()
    putSettingsMock.mockResolvedValue({ display_name: 'Agent Mistral' })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('writes through useToolSettings(agentId) on create when scope is agent', async () => {
    const wrapper = mount(SpeechProviderConfigForm, {
      props: { provider, config: null, scope: 'agent', agentId: 42 },
      attachTo: document.body,
    })
    await wrapper.find('#speech-display_name').setValue('Agent Mistral')
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(putSettingsMock).toHaveBeenCalledTimes(1)
    expect(putSettingsMock.mock.calls[0][0]).toBe(provider.class)
    expect(putSettingsMock.mock.calls[0][1]).toMatchObject({
      display_name: 'Agent Mistral',
      model: 'whisper-1',
    })
    expect(storeUpsertMock).not.toHaveBeenCalled()
    expect(storeUpdateMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeTruthy()
    wrapper.unmount()
  })
})
