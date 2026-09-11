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

vi.mock('vue-router', () => ({
  useRoute: () => routeRef.value,
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}))

vi.mock('@/composables/useAdminAuth', () => ({
  useAdminAuth: () => ({ get isAdmin() { return isAdminRef.value } }),
}))

const configsRef = ref<Array<{
  id: number
  provider_class: string
  provider_display_name: string
  scope: 'global' | 'user'
  display_name: string
  settings: Record<string, string>
  created_at: string
  updated_at: string
}>>([])
const providersRef = ref<Array<{ class: string; display_name: string; settings_schema: unknown[] }>>([])
const loadingConfigsRef = ref(false)
const loadingProvidersRef = ref(false)
const errorRef = ref<string | null>(null)
const ensureMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    get configs() { return configsRef.value },
    get providers() { return providersRef.value },
    get personalConfigs() { return configsRef.value.filter((c) => c.scope === 'user') },
    get globalConfigs() { return configsRef.value.filter((c) => c.scope === 'global') },
    get loadingConfigs() { return loadingConfigsRef.value },
    get loadingProviders() { return loadingProvidersRef.value },
    get error() { return errorRef.value },
    ensure: ensureMock,
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
}
const userConfig = {
  ...globalConfig,
  id: 12,
  scope: 'user' as const,
  display_name: 'Personal Mistral',
}

beforeEach(() => {
  setActivePinia(createPinia())
  routeRef.value = { name: 'settings-speech', query: {} }
  replaceMock.mockReset()
  pushMock.mockReset()
  isAdminRef.value = false
  configsRef.value = []
  providersRef.value = []
  loadingConfigsRef.value = false
  loadingProvidersRef.value = false
  errorRef.value = null
  ensureMock.mockClear().mockResolvedValue(undefined)
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

  it('onDeleted returns to the list view and clears the URL', async () => {
    configsRef.value = [userConfig]
    providersRef.value = [openAiProvider]
    routeRef.value = { name: 'settings-speech', query: { config: '12' } }
    const wrapper = mountPage()
    await flushPromises()
    const edit = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await edit.vm.$emit('deleted')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-speech' })
    expect(wrapper.find('.list-stub').exists()).toBe(true)
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
})
