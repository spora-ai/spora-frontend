/**
 * SpeechProviderConfigsPage — list / create / edit views for speech
 * provider configurations, driven by `?create=1` and `?config=<id>`
 * query params. Same page mounts at `/settings/speech` and
 * `/admin/settings/speech-providers` with different `scope` props.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const routeRef = ref<{ name?: string; query?: Record<string, string> }>({ name: 'settings-speech', query: {} })
const replaceMock = vi.fn()
const pushMock = vi.fn()
const isAdminRef = ref(false)
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => routeRef.value,
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}))

vi.mock('@/composables/useAdminAuth', () => ({
  useAdminAuth: () => ({ get isAdmin() { return isAdminRef.value } }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}))

const configsRef = ref<Array<{
  id: number
  provider_class: string
  provider_display_name: string
  scope: 'global' | 'user'
  display_name: string
  settings: Record<string, string>
  is_default: boolean
  created_at: string
  updated_at: string
}>>([])
const providersRef = ref<Array<{ class: string; display_name: string; settings_schema: unknown[] }>>([])
// The mock exposes preferredSpeech as a getter+setter so the page's
// `store.preferredSpeech = updated` write-back path is reflected in
// the test without forcing every test to reach into a separate setter.
const preferredSpeechRef = ref<{ provider_class: string | null; scope: 'user' | 'group'; group_id: number | null } | null>(null)
const loadingConfigsRef = ref(false)
const loadingProvidersRef = ref(false)
const errorRef = ref<string | null>(null)
const ensureMock = vi.fn().mockResolvedValue(undefined)
const setPreferredMock = vi.fn()

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    get configs() { return configsRef.value },
    get providers() { return providersRef.value },
    get personalConfigs() { return configsRef.value.filter((c) => c.scope === 'user') },
    get globalConfigs() { return configsRef.value.filter((c) => c.scope === 'global') },
    get preferredSpeech() { return preferredSpeechRef.value },
    set preferredSpeech(v: typeof preferredSpeechRef.value) { preferredSpeechRef.value = v },
    get loadingConfigs() { return loadingConfigsRef.value },
    get loadingProviders() { return loadingProvidersRef.value },
    get error() { return errorRef.value },
    ensure: ensureMock,
    setPreferred: setPreferredMock,
    providerByClass: (className: string) => providersRef.value.find((p) => p.class === className) ?? null,
  }),
}))

const ListStub = {
  name: 'SpeechProviderConfigList',
  props: ['scope'],
  emits: ['select', 'create'],
  template: '<div class="list-stub"><button class="select-1" @click="$emit(\'select\', $attrs.cfg1)">x</button><button class="create-btn" @click="$emit(\'create\')">c</button></div>',
}
const CreateStub = { name: 'SpeechProviderCreateForm', emits: ['created', 'cancel'], template: '<div class="create-stub" />' }
const EditStub = { name: 'SpeechProviderConfigForm', emits: ['saved', 'deleted', 'cancel'], template: '<div class="edit-stub" />' }

import SpeechProviderConfigsPage from '@/pages/settings/SpeechProviderConfigsPage.vue'

const openAiProvider = { class: 'Spora\\Speech\\OpenAiCompatibleTranscriber', display_name: 'OpenAI Compatible', settings_schema: [] }
const globalConfig = {
  id: 7,
  provider_class: openAiProvider.class,
  provider_display_name: 'OpenAI Compatible',
  scope: 'global' as const,
  display_name: 'Mistral Voxtral (prod)',
  settings: {},
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
}
const userConfig = {
  ...globalConfig,
  id: 12,
  scope: 'user' as const,
  display_name: 'Personal Mistral',
  is_default: false,
}

beforeEach(() => {
  setActivePinia(createPinia())
  routeRef.value = { name: 'settings-speech', query: {} }
  replaceMock.mockReset()
  pushMock.mockReset()
  isAdminRef.value = false
  toastSuccessMock.mockReset()
  toastErrorMock.mockReset()
  configsRef.value = []
  providersRef.value = []
  preferredSpeechRef.value = null
  loadingConfigsRef.value = false
  loadingProvidersRef.value = false
  errorRef.value = null
  ensureMock.mockClear().mockResolvedValue(undefined)
  setPreferredMock.mockReset()
  setPreferredMock.mockResolvedValue({
    provider_class: openAiProvider.class,
    scope: 'user',
    group_id: null,
  })
})

function mountPage(props: { scope?: 'global' | 'user' } = {}) {
  return mount(SpeechProviderConfigsPage, {
    props: { scope: props.scope ?? 'user' },
    global: {
      stubs: {
        SpeechProviderConfigList: ListStub,
        SpeechProviderCreateForm: CreateStub,
        SpeechProviderConfigForm: EditStub,
      },
    },
  })
}

describe('SpeechProviderConfigsPage', () => {
  it('renders the list view by default', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.list-stub').exists()).toBe(true)
    expect(wrapper.find('.create-stub').exists()).toBe(false)
    expect(wrapper.find('.edit-stub').exists()).toBe(false)
  })

  it('calls ensure() on mount', async () => {
    mountPage()
    await flushPromises()
    expect(ensureMock).toHaveBeenCalled()
  })

  it('switches to create view when ?create=1 is in the URL', async () => {
    routeRef.value = { name: 'settings-speech', query: { create: '1' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.create-stub').exists()).toBe(true)
  })

  it('switches to edit view when ?config=<id> matches a personal config', async () => {
    configsRef.value = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.edit-stub').exists()).toBe(true)
  })

  it('falls back to the list view when ?config=<id> has no matching config', async () => {
    configsRef.value = []
    routeRef.value = { name: 'settings-speech', query: { config: '999' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.list-stub').exists()).toBe(true)
  })

  it('selectConfig navigates to edit view and updates the URL', async () => {
    configsRef.value = [userConfig]
    providersRef.value = [openAiProvider]
    const wrapper = mountPage()
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    await list.vm.$emit('select', userConfig)
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: { config: '12' } })
    expect(wrapper.find('.edit-stub').exists()).toBe(true)
  })

  it('startCreate switches to the create view and updates the URL', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    await list.vm.$emit('create')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: { create: '1' } })
    expect(wrapper.find('.create-stub').exists()).toBe(true)
  })

  it('onCreated switches to edit view of the new config', async () => {
    configsRef.value = [userConfig]
    const wrapper = mountPage()
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    await list.vm.$emit('create')
    await flushPromises()
    const create = wrapper.findComponent({ name: 'SpeechProviderCreateForm' })
    await create.vm.$emit('created', { ...userConfig, id: 99 })
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: { config: '99' } })
  })

  it('onDeleted returns to the list view, clears the URL, and fires a user-scope toast', async () => {
    configsRef.value = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('deleted')
    await flushPromises()
    // The replace call must explicitly clear the query — Vue Router
    // preserves it when none is specified, which would leave the
    // just-deleted `?config=12` in the URL bar.
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: {} })
    expect(wrapper.find('.list-stub').exists()).toBe(true)
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Speech provider configuration deleted.',
    )
  })

  it('onDeleted on the global admin route fires a global-scoped toast and clears the URL', async () => {
    isAdminRef.value = true
    configsRef.value = [globalConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-admin-speech-providers', query: { config: '7' } }
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('deleted')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({
      name: 'settings-admin-speech-providers',
      query: {},
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Global speech provider deleted.')
  })

  it('cancel() (the "← All configurations" path) also clears the URL query', async () => {
    configsRef.value = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('cancel')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: {} })
  })

  it('renders the forbidden page for non-admin callers on the admin route', async () => {
    isAdminRef.value = false
    configsRef.value = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    expect(wrapper.text()).toContain('Forbidden')
    expect(wrapper.find('.list-stub').exists()).toBe(false)
  })

  it('renders the admin list for admin callers on the admin route', async () => {
    isAdminRef.value = true
    configsRef.value = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Forbidden')
    expect(wrapper.find('.list-stub').exists()).toBe(true)
  })

  it('uses the admin route name when navigating from the admin-scope view', async () => {
    isAdminRef.value = true
    configsRef.value = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    await list.vm.$emit('select', globalConfig)
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-speech-providers', query: { config: '7' } })
  })

  it('hides global configs from the user-scope list', async () => {
    configsRef.value = [globalConfig, userConfig]
    const wrapper = mountPage({ scope: 'user' })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    const scopeProp = list.props('scope')
    expect(scopeProp).toBe('user')
  })

  it('surfaces the store error via AlertBanner', async () => {
    errorRef.value = 'Server returned a malformed response.'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('Server returned a malformed response.')
  })

  // Preferred STT widget — mirrors the "Preferred LLM" card on
  // SettingsLLMPage.vue:107-135. Renders only for user scope; the group
  // page has its own scope-aware widget and the global admin page
  // doesn't surface a preference at all (admins configure defaults via
  // the Set-as-Global-Default button on each config row).
  describe('Preferred STT widget', () => {
    it('renders on user scope with all personal + global configs as candidates', async () => {
      configsRef.value = [userConfig, globalConfig]
      const wrapper = mountPage({ scope: 'user' })
      await flushPromises()
      const select = wrapper.find('[data-testid="preferred-stt-select"]')
      expect(select.exists()).toBe(true)
      // Both user and global rows surface — the dropdown is ordered
      // personal first, then global. The "— Use global default —"
      // null option is always present.
      const optionTexts = select.findAll('option').map((o) => o.text())
      expect(optionTexts).toContain('— Use global default —')
      // The dropdown surfaces the row's operator-chosen label and
      // appends the provider's friendly name in parens whenever they
      // differ — operators who set "Personal Mistral" see the driver
      // underneath so they can tell which class it maps to.
      expect(optionTexts).toContain('Personal Mistral (OpenAI Compatible)')
      expect(optionTexts).toContain('Mistral Voxtral (prod) (OpenAI Compatible)')
    })

    it('does not render on global scope (admin-only route has no preference widget)', async () => {
      isAdminRef.value = true
      configsRef.value = [globalConfig]
      const wrapper = mountPage({ scope: 'global' })
      await flushPromises()
      expect(wrapper.find('[data-testid="preferred-stt-select"]').exists()).toBe(false)
    })

    it('calls store.setPreferred with the selected class on Save', async () => {
      configsRef.value = [userConfig]
      preferredSpeechRef.value = null
      const wrapper = mountPage({ scope: 'user' })
      await flushPromises()
      const select = wrapper.find('[data-testid="preferred-stt-select"]')
      await select.setValue(openAiProvider.class)
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      await saveBtn.trigger('click')
      await flushPromises()
      expect(setPreferredMock).toHaveBeenCalledTimes(1)
      expect(setPreferredMock).toHaveBeenCalledWith({
        provider_class: openAiProvider.class,
        scope: 'user',
      })
      // The widget mirrors the persisted preference back into the store
      // so the disabled-state of the Save button flips immediately.
      expect(preferredSpeechRef.value?.provider_class).toBe(openAiProvider.class)
    })

    it('disables the Save button when the preference is unchanged', async () => {
      configsRef.value = [userConfig]
      preferredSpeechRef.value = {
        provider_class: openAiProvider.class,
        scope: 'user',
        group_id: null,
      }
      const wrapper = mountPage({ scope: 'user' })
      await flushPromises()
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })
  })
})
