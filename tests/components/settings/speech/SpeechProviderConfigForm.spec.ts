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

const storeSetDefaultMock = vi.fn()

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    update: storeUpdateMock,
    remove: storeRemoveMock,
    upsert: storeUpsertMock,
    setDefault: storeSetDefaultMock,
  }),
}))

// vi.mock factories run before module imports, so the test-controlled
// isAdmin flag has to be hoisted via vi.hoisted to be visible in the
// factory closure. The getter on `isAdmin` re-reads `flag.value` on
// every read so the rendered template picks up the new value on the
// next reactive tick after a test flips the flag.
const adminFlag = vi.hoisted(() => ({ value: false }))
vi.mock('@/composables/useAdminAuth', () => ({
  useAdminAuth: () => ({
    isAdmin: { get value() { return adminFlag.value } },
    isForbidden: { get value() { return !adminFlag.value } },
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
import { ApiError } from '@/api/client'

// String.raw template literals mirror the production wire format byte-for-byte
// (PHP's `#[ToolSetting(validation: '...')]` wires through json_encode verbatim).
// Validating the delimeter-strip path under both flows requires the source
// here to match what the backend ships.
const provider = {
  class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
  display_name: 'OpenAI Compatible',
  settings_schema: [
    { key: 'display_name', label: 'Display name', type: 'text', required: true, validation: String.raw`/^[A-Za-z0-9 _\-\.\(\)]{1,80}$/` },
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true, default: 'whisper-1' },
    { key: 'base_url', label: 'Base URL', type: 'text', required: true, default: 'https://api.openai.com/v1', validation: String.raw`#^https?://[^\s]+$#` },
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
  storeSetDefaultMock.mockReset()
  adminFlag.value = false
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

  // The real backend ships the schema's `validation` regex wrapped in PCRE
  // delimiters (`/^...$/`, `#^...$#`). Older versions of the form passed
  // that string straight to `new RegExp(...)`, which treated the delimiters
  // as literal characters and rejected every input — operators could not
  // save a valid "Mistral Voxtral" / `https://api.mistral.ai/v1` config
  // through the UI. The two tests below assert the delimeter-strip fix.
  it('accepts valid base_url and display_name values when the schema regex uses PCRE delimiters', async () => {
    const wrapper = mountEdit({
      config: {
        ...existingConfig,
        settings: {
          ...existingConfig.settings,
          display_name: '',
          base_url: '',
        },
      },
    })
    const displayName = wrapper.find('#speech-display_name')
    await displayName.setValue('Mistral Voxtral')
    await displayName.trigger('blur')
    const baseUrl = wrapper.find('#speech-base_url')
    await baseUrl.setValue('https://api.mistral.ai/v1')
    await baseUrl.trigger('blur')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Display name is not in the expected format.')
    expect(wrapper.text()).not.toContain('Base URL is not in the expected format.')
  })

  it('still rejects malformed values when the schema regex uses PCRE delimiters', async () => {
    const wrapper = mountEdit({
      config: {
        ...existingConfig,
        settings: {
          ...existingConfig.settings,
          display_name: '',
          base_url: '',
        },
      },
    })
    const displayName = wrapper.find('#speech-display_name')
    await displayName.setValue('has illegal @ char')
    await displayName.trigger('blur')
    const baseUrl = wrapper.find('#speech-base_url')
    await baseUrl.setValue('not-a-url')
    await baseUrl.trigger('blur')
    await flushPromises()
    expect(wrapper.text()).toContain('Display name is not in the expected format.')
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

  // multi-select renders as a checkbox group driven by `field.options`.
  // The widget stores its value as a JSON-encoded array string so the
  // form layer keeps its `Record<string, string>` shape — the server
  // decodes it back to an array via
  // ToolConfigService::normalizeMultiSelectValues when the provider
  // reads settings.
  describe('multi-select widget', () => {
    const multiProvider = {
      class: 'Spora\\Speech\\MultiSelectTranscriber',
      display_name: 'Multi-select Demo',
      settings_schema: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true },
        {
          key: 'language_bias',
          label: 'Language bias',
          type: 'multi-select',
          // PHP serialises a `key => label` array to a JSON object; the
          // form normalises both shapes so the renderer is uniform.
          options: {
            English: 'English',
            French: 'French',
            German: 'German',
          },
        },
      ],
    }

    it('renders one checkbox per option', () => {
      const wrapper = mount(SpeechProviderConfigForm, {
        props: { provider: multiProvider, config: null, scope: 'user' },
        attachTo: document.body,
      })
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      // One checkbox per language option (no implicit "None" / default).
      expect(checkboxes.length).toBe(3)
      expect(wrapper.text()).toContain('English')
      expect(wrapper.text()).toContain('French')
      expect(wrapper.text()).toContain('German')
      wrapper.unmount()
    })

    it('seeds checkboxes from a JSON-encoded array stored value', () => {
      const config = {
        ...existingConfig,
        provider_class: multiProvider.class,
        provider_display_name: multiProvider.display_name,
        settings: {
          api_key: '***',
          language_bias: '["English","German"]',
        },
      }
      const wrapper = mount(SpeechProviderConfigForm, {
        props: { provider: multiProvider, config, scope: 'user' },
        attachTo: document.body,
      })
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      const englishBox = checkboxes.find(
        (cb) => (cb.element as HTMLInputElement).value === 'English',
      )!
      const frenchBox = checkboxes.find(
        (cb) => (cb.element as HTMLInputElement).value === 'French',
      )!
      expect((englishBox.element as HTMLInputElement).checked).toBe(true)
      expect((frenchBox.element as HTMLInputElement).checked).toBe(false)
      wrapper.unmount()
    })

    it('toggles selection and JSON-encodes the array on submit', async () => {
      storeUpsertMock.mockReset()
      storeUpsertMock.mockResolvedValueOnce({
        ...existingConfig,
        provider_class: multiProvider.class,
        settings: { api_key: '***', language_bias: '["English","French"]' },
      })

      const wrapper = mount(SpeechProviderConfigForm, {
        props: { provider: multiProvider, config: null, scope: 'user' },
        attachTo: document.body,
      })
      await wrapper.find('#speech-api_key').setValue('sk-x')

      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      const englishBox = checkboxes.find(
        (cb) => (cb.element as HTMLInputElement).value === 'English',
      )!
      const frenchBox = checkboxes.find(
        (cb) => (cb.element as HTMLInputElement).value === 'French',
      )!
      await englishBox.setValue(true)
      await frenchBox.setValue(true)
      await flushPromises()

      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(storeUpsertMock).toHaveBeenCalledTimes(1)
      const payload = storeUpsertMock.mock.calls[0][0]
      expect(payload.settings.language_bias).toBe('["English","French"]')
      wrapper.unmount()
    })

    it('toggles off an already-selected option', async () => {
      const config = {
        ...existingConfig,
        provider_class: multiProvider.class,
        settings: {
          api_key: '***',
          language_bias: '["English","French"]',
        },
      }
      const wrapper = mount(SpeechProviderConfigForm, {
        props: { provider: multiProvider, config, scope: 'user' },
        attachTo: document.body,
      })
      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      const frenchBox = checkboxes.find(
        (cb) => (cb.element as HTMLInputElement).value === 'French',
      )!
      await frenchBox.setValue(false)
      await flushPromises()

      // The form-layer state now contains only English.
      const vm = wrapper.vm as unknown as { form: Record<string, string> }
      expect(JSON.parse(vm.form.language_bias)).toEqual(['English'])
      wrapper.unmount()
    })
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

  it('renders the top back button in edit mode (v-if=isEdit)', () => {
    // existingConfig has an id, so isEdit=true → the back button shows.
    const wrapper = mountEdit({ config: existingConfig })
    const back = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('All configurations'))
    expect(back).toBeDefined()
  })

  it('does not render the top back button in create mode (config=null)', () => {
    // The inner form's top back link is gated by `isEdit` so the create
    // flow doesn't carry a duplicate "← All configurations" — the
    // SpeechProviderCreateForm owns the entry/exit instead (via its
    // bottom Cancel button).
    const wrapper = mountEdit({ config: null })
    const back = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('All configurations'))
    expect(back).toBeUndefined()
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

  // Regression: clicking Change on a masked password clears the field to
  // '' (so the operator can type a new value). The previous validator
  // treated that empty intermediate state as "required is missing" and
  // rejected save — even when the operator only intended to change other
  // fields. Now empty-or-'***' on a password slot whose initial was '***'
  // is treated as "keep the existing key" (matches the existing submit
  // payload path in `buildSettingsToSend`).
  it('does not require the API Key when an existing config is left at the masked sentinel', async () => {
    storeUpdateMock.mockReset()
    const wrapper = mountEdit()
    const changeBtn = wrapper
      .findAll('button')
      .find((b) => (b.text() ?? '').trim() === 'Change')!
    await changeBtn.trigger('click')
    await flushPromises()
    // After Change, the input is rendered and `form.api_key` is ''.
    // A different field is touched so the operator clearly meant to save.
    await wrapper.find('#speech-display_name').setValue('Personal Mistral (updated)')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).not.toContain('API Key is required.')
    expect(storeUpdateMock).toHaveBeenCalled()
    const payload = storeUpdateMock.mock.calls[0][1]
    // The masked password must be omitted from the payload — the server
    // re-decrypts the existing key in place. (Same contract as the
    // buildSettingsToSend happy-path, asserted here against the live
    // submit path.)
    expect(payload.settings.api_key).toBeUndefined()
    // The non-password field the operator did touch is in the payload.
    expect(payload.settings.display_name).toBe('Personal Mistral (updated)')
  })

  it('still requires the API Key when creating a new config and leaving it empty', async () => {
    // The masked-sentinel shortcut must NOT apply in create mode —
    // there's no existing key to keep.
    storeUpsertMock.mockResolvedValueOnce({ ...existingConfig, id: 99 })
    const wrapper = mountEdit({ config: null, scope: 'user' })
    await wrapper.find('#speech-display_name').setValue('Fresh Mistral')
    await wrapper.find('#speech-api_key').setValue('')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.mistral.ai/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('API Key is required.')
    expect(storeUpsertMock).not.toHaveBeenCalled()
  })

  // Set-as-Default visibility mirrors LLMConfigEditForm.vue:29-31:
  // visible only when isAdmin && scope=global && !is_default. The badge
  // replaces the button when is_default=true. Both checks protect
  // operators from a destructive state mutation they can't authorise.
  describe('Set as Global Default button + Default badge', () => {
    it('shows the button for admins on a global, non-default existing config', () => {
      adminFlag.value = true
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: false } as typeof existingConfig,
        scope: 'global',
      })
      const btn = wrapper.find('[data-testid="set-default-button"]')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe('Set as Global Default')
    })

    it('hides the button when the caller is not an admin', () => {
      adminFlag.value = false
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: false } as typeof existingConfig,
        scope: 'global',
      })
      expect(wrapper.find('[data-testid="set-default-button"]').exists()).toBe(false)
    })

    it('hides the button and shows the badge when the config is already default', () => {
      adminFlag.value = true
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: true } as typeof existingConfig,
        scope: 'global',
      })
      expect(wrapper.find('[data-testid="set-default-button"]').exists()).toBe(false)
      const badge = wrapper.find('[data-testid="default-badge"]')
      expect(badge.exists()).toBe(true)
      expect(badge.text()).toBe('Global default')
    })

    it('hides the button when scope is user (admin-only escalation)', () => {
      adminFlag.value = true
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'user', is_default: false } as typeof existingConfig,
        scope: 'user',
      })
      expect(wrapper.find('[data-testid="set-default-button"]').exists()).toBe(false)
    })

    it('hides the button when scope is group (only global configs can be promoted)', () => {
      adminFlag.value = true
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'group', is_default: false } as typeof existingConfig,
        scope: 'group',
      })
      expect(wrapper.find('[data-testid="set-default-button"]').exists()).toBe(false)
    })

    it('hides the button in create mode (no row to promote yet)', () => {
      adminFlag.value = true
      const wrapper = mountEdit({ config: null, scope: 'global' })
      expect(wrapper.find('[data-testid="set-default-button"]').exists()).toBe(false)
    })

    it('calls store.setDefault with the config id when the button is clicked', async () => {
      adminFlag.value = true
      const promoted = { ...existingConfig, scope: 'global', is_default: true }
      storeSetDefaultMock.mockResolvedValueOnce(promoted)
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: false } as typeof existingConfig,
        scope: 'global',
      })
      await wrapper.find('[data-testid="set-default-button"]').trigger('click')
      await flushPromises()
      expect(storeSetDefaultMock).toHaveBeenCalledTimes(1)
      expect(storeSetDefaultMock).toHaveBeenCalledWith(existingConfig.id)
      // applyServerResult runs after a successful promote — the form
      // emits saved so the parent page can refresh its cache.
      expect(wrapper.emitted('saved')).toBeTruthy()
    })

    it('surfaces an inline error when the promote call fails', async () => {
      adminFlag.value = true
      storeSetDefaultMock.mockRejectedValueOnce(new ApiError('Admins only.', 'FORBIDDEN', 403))
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: false } as typeof existingConfig,
        scope: 'global',
      })
      await wrapper.find('[data-testid="set-default-button"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Admins only.')
    })
  })

  // Mirrors `LLMConfigCreateForm.vue:181-194`. Only admins creating a
  // global-scope config see the checkbox — once a row exists, the edit
  // form's "Set as Global Default" button takes over.
  describe('Set as global default checkbox (create mode)', () => {
    it('renders the checkbox for admins creating a global config', () => {
      adminFlag.value = true
      const wrapper = mountEdit({ config: null, scope: 'global' })
      const cb = wrapper.find('[data-testid="set-as-default-checkbox"]')
      expect(cb.exists()).toBe(true)
      expect(cb.element.tagName).toBe('INPUT')
      expect((cb.element as HTMLInputElement).type).toBe('checkbox')
      expect(wrapper.text()).toContain('Set as global default')
    })

    it('hides the checkbox for non-admins (even with global scope)', () => {
      adminFlag.value = false
      const wrapper = mountEdit({ config: null, scope: 'global' })
      expect(wrapper.find('[data-testid="set-as-default-checkbox"]').exists()).toBe(false)
    })

    it('hides the checkbox when scope is user or group', () => {
      adminFlag.value = true
      const userWrapper = mountEdit({ config: null, scope: 'user' })
      expect(userWrapper.find('[data-testid="set-as-default-checkbox"]').exists()).toBe(false)
      userWrapper.unmount()
      const groupWrapper = mount(SpeechProviderConfigForm, {
        props: { provider, config: null, scope: 'group', groupId: 7 },
        attachTo: document.body,
      })
      expect(groupWrapper.find('[data-testid="set-as-default-checkbox"]').exists()).toBe(false)
      groupWrapper.unmount()
    })

    it('hides the checkbox in edit mode (the button takes over)', () => {
      adminFlag.value = true
      const wrapper = mountEdit({
        config: { ...existingConfig, scope: 'global', is_default: false } as typeof existingConfig,
        scope: 'global',
      })
      expect(wrapper.find('[data-testid="set-as-default-checkbox"]').exists()).toBe(false)
    })

    it('upserts and then promotes when the checkbox is ticked and the form is submitted', async () => {
      adminFlag.value = true
      const created = { ...existingConfig, id: 99, scope: 'global' as const, is_default: false }
      const promoted = { ...created, is_default: true }
      storeUpsertMock.mockResolvedValueOnce(created)
      storeSetDefaultMock.mockResolvedValueOnce(promoted)

      const wrapper = mountEdit({ config: null, scope: 'global' })
      const cb = wrapper.find('[data-testid="set-as-default-checkbox"]')
      await cb.setValue(true)
      await flushPromises()
      await wrapper.find('#speech-display_name').setValue('Fresh Global')
      await wrapper.find('#speech-api_key').setValue('sk-x')
      await wrapper.find('#speech-model').setValue('whisper-1')
      await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(storeUpsertMock).toHaveBeenCalledTimes(1)
      expect(storeUpsertMock.mock.calls[0][0]).toMatchObject({
        provider_class: provider.class,
        scope: 'global',
      })
      expect(storeSetDefaultMock).toHaveBeenCalledTimes(1)
      expect(storeSetDefaultMock).toHaveBeenCalledWith(99)
      // The promoted row (with is_default=true) is what the form emits —
      // the parent page's cache reflects the post-promote truth.
      expect(wrapper.emitted('saved')).toBeTruthy()
      expect(wrapper.emitted('saved')![0][0]).toMatchObject({ id: 99, is_default: true })
    })

    it('does NOT call setDefault when the checkbox is left unticked', async () => {
      adminFlag.value = true
      const created = { ...existingConfig, id: 99, scope: 'global' as const, is_default: false }
      storeUpsertMock.mockResolvedValueOnce(created)

      const wrapper = mountEdit({ config: null, scope: 'global' })
      await wrapper.find('#speech-display_name').setValue('Fresh Global')
      await wrapper.find('#speech-api_key').setValue('sk-x')
      await wrapper.find('#speech-model').setValue('whisper-1')
      await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(storeUpsertMock).toHaveBeenCalledTimes(1)
      expect(storeSetDefaultMock).not.toHaveBeenCalled()
    })

    it('surfaces a non-fatal warning when upsert succeeds but promote fails', async () => {
      adminFlag.value = true
      const created = { ...existingConfig, id: 99, scope: 'global' as const, is_default: false }
      storeUpsertMock.mockResolvedValueOnce(created)
      storeSetDefaultMock.mockRejectedValueOnce(new ApiError('Admins only.', 'FORBIDDEN', 403))

      const wrapper = mountEdit({ config: null, scope: 'global' })
      await wrapper.find('[data-testid="set-as-default-checkbox"]').setValue(true)
      await wrapper.find('#speech-display_name').setValue('Fresh Global')
      await wrapper.find('#speech-api_key').setValue('sk-x')
      await wrapper.find('#speech-model').setValue('whisper-1')
      await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      // The save still succeeded — the form emitted `saved` with the
      // upserted row (not the promoted one). The promote failure shows
      // up as an inline warning instead of an unrecoverable error.
      expect(wrapper.emitted('saved')).toBeTruthy()
      expect(wrapper.emitted('saved')![0][0]).toMatchObject({ id: 99, is_default: false })
      expect(wrapper.text()).toContain('Admins only.')
    })
  })
})

describe('SpeechProviderConfigForm — scope: group', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpdateMock.mockReset()
    storeRemoveMock.mockReset()
    storeUpsertMock.mockReset()
    storeSetDefaultMock.mockReset()
    adminFlag.value = false
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

describe('SpeechProviderConfigForm — display_name forwarding', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpsertMock.mockReset()
    storeUpdateMock.mockReset()
    adminFlag.value = false
  })

  it('forwards display_name on user-scope creates (regression: scope guard dropped)', async () => {
    storeUpsertMock.mockResolvedValueOnce({ ...existingConfig, id: 99, scope: 'user' })
    const wrapper = mount(SpeechProviderConfigForm, {
      props: { provider, config: null, scope: 'user' },
      attachTo: document.body,
    })
    await wrapper.find('#speech-display_name').setValue('Mistral User')
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpsertMock).toHaveBeenCalledTimes(1)
    expect(storeUpsertMock.mock.calls[0][0]).toMatchObject({
      provider_class: provider.class,
      scope: 'user',
      display_name: 'Mistral User',
    })
    wrapper.unmount()
  })

  it('forwards display_name on group-scope creates', async () => {
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

    expect(storeUpsertMock.mock.calls[0][0]).toMatchObject({
      scope: 'group',
      group_id: 7,
      display_name: 'Team Mistral',
    })
    wrapper.unmount()
  })

  it('omits display_name from the wire payload when the form field is empty (backend defaults to FQCN)', async () => {
    storeUpsertMock.mockResolvedValueOnce({ ...existingConfig, id: 99, scope: 'user' })
    const optionalProvider = {
      class: provider.class,
      display_name: provider.display_name,
      settings_schema: provider.settings_schema.map((f) =>
        f.key === 'display_name' ? { ...f, required: false } : f,
      ),
    }
    const wrapper = mount(SpeechProviderConfigForm, {
      props: { provider: optionalProvider, config: null, scope: 'user' },
      attachTo: document.body,
    })
    // Leave display_name empty.
    await wrapper.find('#speech-api_key').setValue('sk-x')
    await wrapper.find('#speech-model').setValue('whisper-1')
    await wrapper.find('#speech-base_url').setValue('https://api.openai.com/v1')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    const payload = storeUpsertMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('display_name')
    wrapper.unmount()
  })
})

describe('SpeechProviderConfigForm — rename action (edit mode)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpdateMock.mockReset()
    storeUpsertMock.mockReset()
    adminFlag.value = false
  })

  it('renders the Rename button in the title row when editing', () => {
    const wrapper = mountEdit()
    expect(wrapper.find('[data-testid="rename-button"]').exists()).toBe(true)
  })

  it('does NOT render the Rename button in create mode', () => {
    const wrapper = mountEdit({ config: null, scope: 'user' })
    expect(wrapper.find('[data-testid="rename-button"]').exists()).toBe(false)
  })

  it('opens the rename modal pre-filled with the current display_name', async () => {
    const wrapper = mountEdit()
    await wrapper.find('[data-testid="rename-button"]').trigger('click')
    await flushPromises()
    const input = document.body.querySelector('[data-testid="rename-input"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input!.value).toBe('Personal Mistral')
    wrapper.unmount()
  })

  it('calls store.update with {display_name: ...} and closes the modal on confirm', async () => {
    const renamed = { ...existingConfig, display_name: 'Personal Mistral Renamed' }
    storeUpdateMock.mockResolvedValueOnce(renamed)
    const wrapper = mountEdit()
    await wrapper.find('[data-testid="rename-button"]').trigger('click')
    await flushPromises()
    const input = document.body.querySelector('[data-testid="rename-input"]') as HTMLInputElement
    input.value = 'Personal Mistral Renamed'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    const confirmBtn = document.body.querySelector('[data-testid="rename-confirm"]') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(storeUpdateMock).toHaveBeenCalledTimes(1)
    expect(storeUpdateMock).toHaveBeenCalledWith(7, { display_name: 'Personal Mistral Renamed' })
    expect(document.body.querySelector('[data-testid="rename-input"]')).toBeNull()
    wrapper.unmount()
  })

  it('skips the API call when the new value is unchanged (no-op)', async () => {
    const wrapper = mountEdit()
    await wrapper.find('[data-testid="rename-button"]').trigger('click')
    await flushPromises()
    const confirmBtn = document.body.querySelector('[data-testid="rename-confirm"]') as HTMLButtonElement
    expect(confirmBtn).not.toBeNull()
    confirmBtn.click()
    await flushPromises()

    expect(storeUpdateMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('surfaces an inline error when the rename API call fails', async () => {
    storeUpdateMock.mockRejectedValueOnce(new ApiError('Validation failed', 'INVALID', 422))
    const wrapper = mountEdit()
    await wrapper.find('[data-testid="rename-button"]').trigger('click')
    await flushPromises()
    const input = document.body.querySelector('[data-testid="rename-input"]') as HTMLInputElement
    input.value = 'New Name'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    const confirmBtn = document.body.querySelector('[data-testid="rename-confirm"]') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(wrapper.text()).toContain('Validation failed')
    expect(document.body.querySelector('[data-testid="rename-input"]')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('SpeechProviderConfigForm — defaults pre-fill + edit display_name forwarding', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeUpsertMock.mockReset()
    storeUpdateMock.mockReset()
    adminFlag.value = false
  })

  it('pre-fills schema defaults into a new config form so empty fields land with sensible values', async () => {
    const wrapper = mount(SpeechProviderConfigForm, {
      props: { provider, config: null, scope: 'user' },
      attachTo: document.body,
    })
    await flushPromises()
    // base_url and model carry defaults in the schema.
    const baseUrl = wrapper.find('#speech-base_url').element as HTMLInputElement
    const model = wrapper.find('#speech-model').element as HTMLInputElement
    expect(baseUrl.value).toBe('https://api.openai.com/v1')
    expect(model.value).toBe('whisper-1')
    // display_name has no default — stays empty (operator must label).
    const displayName = wrapper.find('#speech-display_name').element as HTMLInputElement
    expect(displayName.value).toBe('')
    wrapper.unmount()
  })

  it('keeps an existing config\'s settings when the operator edits (defaults do NOT clobber)', async () => {
    const wrapper = mountEdit({ config: { ...existingConfig, settings: { ...existingConfig.settings, base_url: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest' } } })
    await flushPromises()
    const baseUrl = wrapper.find('#speech-base_url').element as HTMLInputElement
    const model = wrapper.find('#speech-model').element as HTMLInputElement
    expect(baseUrl.value).toBe('https://api.mistral.ai/v1')
    expect(model.value).toBe('voxtral-mini-latest')
    wrapper.unmount()
  })

  it('edit save forwards a changed display_name to the wire payload (regression: column stayed stale)', async () => {
    const updated = { ...existingConfig, display_name: 'Personal Mistral Renamed', settings: { ...existingConfig.settings, display_name: 'Personal Mistral Renamed' } }
    storeUpdateMock.mockResolvedValueOnce(updated)
    const wrapper = mountEdit()
    await wrapper.find('#speech-display_name').setValue('Personal Mistral Renamed')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpdateMock).toHaveBeenCalledTimes(1)
    expect(storeUpdateMock.mock.calls[0][0]).toBe(7)
    expect(storeUpdateMock.mock.calls[0][1]).toMatchObject({
      display_name: 'Personal Mistral Renamed',
    })
    // settings still goes through too — display_name lives in both places.
    expect(storeUpdateMock.mock.calls[0][1]).toHaveProperty('settings')
    wrapper.unmount()
  })

  it('edit save forwards display_name when unchanged (so the row column tracks in-form edits even when only settings change)', async () => {
    // Operator changes a setting but leaves the display_name alone — the
    // form should still forward the in-form display_name so the row
    // column stays consistent with whatever is showing in the form.
    const updated = { ...existingConfig, settings: { ...existingConfig.settings, notes: 'a note' } }
    storeUpdateMock.mockResolvedValueOnce(updated)
    const wrapper = mountEdit()
    await wrapper.find('#speech-notes').setValue('a note')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeUpdateMock).toHaveBeenCalledTimes(1)
    expect(storeUpdateMock.mock.calls[0][1]).toMatchObject({
      display_name: 'Personal Mistral',
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
    storeSetDefaultMock.mockReset()
    adminFlag.value = false
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
