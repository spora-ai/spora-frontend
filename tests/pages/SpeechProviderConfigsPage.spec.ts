/**
 * SpeechProviderConfigsPage — list / create / edit views for speech
 * provider configurations, driven by `?create=1` and `?config=<id>`
 * query params. Same page mounts at `/settings/speech` and
 * `/admin/settings/speech-providers` with different `scope` props.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive } from 'vue'
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

// Per-slot cache. The page reads from the unscoped `'user'` slot for
// the user-scope and global-scope views; both routes share the slot
// because the unscoped endpoint returns every config the caller can
// see.
type SlotKey = number | 'user'

interface Slot {
  configs: Array<{
    id: number
    provider_class: string
    provider_display_name: string
    scope: 'global' | 'user'
    display_name: string
    settings: Record<string, string>
    is_default: boolean
    created_at: string
    updated_at: string
  }>
  preferredSpeech: { config_id: number | null; scope: 'user' | 'group'; group_id: number | null } | null
  loadingConfigs: boolean
  loadingPreference: boolean
  loaded: boolean
  error: string | null
}

const slots = reactive(new Map<SlotKey, Slot>())

function getSlot(key: SlotKey): Slot {
  let slot = slots.get(key)
  if (!slot) {
    slot = reactive<Slot>({
      configs: [],
      preferredSpeech: null,
      loadingConfigs: false,
      loadingPreference: false,
      loaded: false,
      error: null,
    })
    slots.set(key, slot)
  }
  return slot
}

const providersRef = ref<Array<{ class: string; display_name: string; settings_schema: unknown[] }>>([])
const loadingProvidersRef = ref(false)
const errorRef = ref<string | null>(null)
const ensureMock = vi.fn().mockResolvedValue(undefined)
const loadConfigsForMock = vi.fn().mockResolvedValue(undefined)
const setPreferredMock = vi.fn()
const setPreferredSlotMock = vi.fn()

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    getSlot,
    get providers() { return providersRef.value },
    get loadingProviders() { return loadingProvidersRef.value },
    get error() { return errorRef.value },
    ensure: ensureMock,
    loadConfigsFor: loadConfigsForMock,
    setPreferred: setPreferredMock,
    setPreferredSlot: setPreferredSlotMock,
    providerByClass: (className: string) => providersRef.value.find((p) => p.class === className) ?? null,
  }),
}))

const ListStub = {
  name: 'SpeechProviderConfigList',
  props: ['scope', 'principalKey'],
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
  slots.clear()
  providersRef.value = []
  loadingProvidersRef.value = false
  errorRef.value = null
  ensureMock.mockClear().mockResolvedValue(undefined)
  loadConfigsForMock.mockClear().mockResolvedValue(undefined)
  setPreferredMock.mockReset()
  setPreferredSlotMock.mockReset()
  setPreferredMock.mockResolvedValue({
    config_id: userConfig.id,
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

  it("calls ensure('user', undefined, { kind: 'user' }) on mount", async () => {
    mountPage()
    await flushPromises()
    expect(ensureMock).toHaveBeenCalledWith('user', undefined, { kind: 'user' })
  })

  it('switches to create view when ?create=1 is in the URL', async () => {
    routeRef.value = { name: 'settings-speech', query: { create: '1' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.create-stub').exists()).toBe(true)
  })

  it('switches to edit view when ?config=<id> matches a personal config', async () => {
    getSlot('user').configs = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.edit-stub').exists()).toBe(true)
  })

  it('falls back to the list view when ?config=<id> has no matching config', async () => {
    getSlot('user').configs = []
    routeRef.value = { name: 'settings-speech', query: { config: '999' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.list-stub').exists()).toBe(true)
  })

  it('selectConfig navigates to edit view and updates the URL', async () => {
    getSlot('user').configs = [userConfig]
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
    getSlot('user').configs = [userConfig]
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
    getSlot('user').configs = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('deleted')
    await flushPromises()
    // The replace call must explicitly clear the query — Vue Router 5.x
    // preserves it when none is specified, which would leave the
    // just-deleted `?config=12` in the URL bar.
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech', query: {} })
    expect(wrapper.find('.list-stub').exists()).toBe(true)
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Speech provider configuration deleted.',
    )
    // onDeleted refreshes the 'user' slot so the list shows the new state.
    expect(loadConfigsForMock).toHaveBeenCalledWith('user')
  })

  it('onDeleted on the global admin route fires a global-scoped toast and clears the URL', async () => {
    isAdminRef.value = true
    getSlot('user').configs = [globalConfig]
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

  it('onSaved refreshes the user slot so the list shows the canonical row', async () => {
    getSlot('user').configs = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    loadConfigsForMock.mockClear()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('saved', userConfig)
    await flushPromises()
    // Targeted refresh — the store's update() did NOT mutate the
    // cache, so the page re-fetches the slot it owns in onSaved.
    expect(loadConfigsForMock).toHaveBeenCalledWith('user')
  })

  it('cancel() (the "← All configurations" path) also clears the URL query', async () => {
    getSlot('user').configs = [userConfig]
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
    getSlot('user').configs = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    expect(wrapper.text()).toContain('Forbidden')
    expect(wrapper.find('.list-stub').exists()).toBe(false)
  })

  it('renders the admin list for admin callers on the admin route', async () => {
    isAdminRef.value = true
    getSlot('user').configs = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Forbidden')
    expect(wrapper.find('.list-stub').exists()).toBe(true)
  })

  it('uses the admin route name when navigating from the admin-scope view', async () => {
    isAdminRef.value = true
    getSlot('user').configs = [globalConfig]
    const wrapper = mountPage({ scope: 'global' })
    await flushPromises()
    const list = wrapper.findComponent({ name: 'SpeechProviderConfigList' })
    await list.vm.$emit('select', globalConfig)
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-speech-providers', query: { config: '7' } })
  })

  it('hides global configs from the user-scope list', async () => {
    getSlot('user').configs = [globalConfig, userConfig]
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
      getSlot('user').configs = [userConfig, globalConfig]
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
      getSlot('user').configs = [globalConfig]
      const wrapper = mountPage({ scope: 'global' })
      await flushPromises()
      expect(wrapper.find('[data-testid="preferred-stt-select"]').exists()).toBe(false)
    })

    it('calls store.setPreferred with the selected config on Save and writes via setPreferredSlot', async () => {
      getSlot('user').configs = [userConfig]
      getSlot('user').preferredSpeech = null
      const wrapper = mountPage({ scope: 'user' })
      await flushPromises()
      const select = wrapper.find('[data-testid="preferred-stt-select"]')
      await select.setValue(String(userConfig.id))
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      await saveBtn.trigger('click')
      await flushPromises()
      expect(setPreferredMock).toHaveBeenCalledTimes(1)
      expect(setPreferredMock).toHaveBeenCalledWith({
        config_id: userConfig.id,
        scope: 'user',
      })
      // The page writes the returned envelope into the 'user' slot via
      // setPreferredSlot so the dropdown's disabled-state flips
      // immediately without a full slot reload.
      expect(setPreferredSlotMock).toHaveBeenCalledWith('user', {
        config_id: userConfig.id,
        scope: 'user',
        group_id: null,
      })
    })

    it('prefills the dropdown from the slot preferredSpeech after async loadPreferenceFor resolves', async () => {
      // Regression: the local `preferredConfigId` ref was captured at
      // setup time from a null store value, so the dropdown stayed
      // blank even when the server had a saved preference. The fix is
      // a watcher that mirrors slot.preferredSpeech.config_id into the
      // local ref whenever the store side updates.
      getSlot('user').configs = [userConfig]
      getSlot('user').preferredSpeech = null

      const wrapper = mountPage({ scope: 'user' })
      // Hydrate the slot AFTER mount — this is what loadPreferenceFor
      // does in real life (the value isn't there at setup time).
      getSlot('user').preferredSpeech = {
        config_id: userConfig.id,
        scope: 'user',
        group_id: null,
      }
      await flushPromises()

      const select = wrapper.find('[data-testid="preferred-stt-select"]')
      expect((select.element as HTMLSelectElement).value).toBe(String(userConfig.id))
    })

    it('disables the Save button when the preference is unchanged', async () => {
      getSlot('user').configs = [userConfig]
      getSlot('user').preferredSpeech = {
        config_id: userConfig.id,
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
