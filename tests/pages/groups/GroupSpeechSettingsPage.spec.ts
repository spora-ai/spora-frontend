/**
 * GroupSpeechSettingsPage — CRUD on speech provider configs scoped to
 * one group. Mirrors `GroupLlmDriversPage` test patterns: mock the
 * detail + speech stores + auth, then exercise list/create/edit/delete.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive, ref } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

interface DetailMock {
  group: Record<string, unknown> | null
  loading: boolean
}

function freshDetail(): DetailMock {
  return { group: { id: 1, name: 'Eng', principal_id: 10, my_role: 'owner' }, loading: false }
}

const detailStoreMock = reactive<DetailMock>(freshDetail())

vi.mock('@/stores/groupDetail', () => ({
  useGroupDetailStore: () => detailStoreMock,
}))

const providersRef = ref<Array<Record<string, unknown>>>([])
const groupConfigsRef = ref<Array<Record<string, unknown>>>([])
const globalConfigsRef = ref<Array<Record<string, unknown>>>([])
const preferredSpeechRef = ref<Record<string, unknown> | null>(null)
const loadingConfigsRef = ref(false)
const savingRef = ref(false)
const errorRef = ref<string | null>(null)

const loadForGroupMock = vi.fn()
const upsertMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const setDefaultMock = vi.fn()
const setPreferredMock = vi.fn()
const ensureMock = vi.fn().mockResolvedValue(undefined)

const speechStoreMock = {
  get providers() { return providersRef.value },
  get groupConfigs() { return groupConfigsRef.value },
  get globalConfigs() { return globalConfigsRef.value },
  get preferredSpeech() { return preferredSpeechRef.value },
  get loadingConfigs() { return loadingConfigsRef.value },
  get saving() { return savingRef.value },
  get error() { return errorRef.value },
  loadForGroup: loadForGroupMock,
  upsert: upsertMock,
  update: updateMock,
  remove: removeMock,
  setDefault: setDefaultMock,
  setPreferred: setPreferredMock,
  ensure: ensureMock,
  providerByClass: (cls: string) => providersRef.value.find((p) => p.class === cls),
}

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => speechStoreMock,
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/auth', () => ({ useAuthStore: useAuthStoreMock }))

import GroupSpeechSettingsPage from '@/pages/groups/GroupSpeechSettingsPage.vue'
import { ApiError } from '@/api/client'

const OPENAI_CLASS = 'Spora\\Speech\\OpenAiCompatibleTranscriber'

const openAiProvider = {
  class: OPENAI_CLASS,
  display_name: 'OpenAI Compatible',
  settings_schema: [],
}

const groupConfigRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  provider_class: OPENAI_CLASS,
  provider_display_name: 'OpenAI Compatible',
  scope: 'group' as const,
  display_name: 'Team Whisper',
  settings: { api_key: '***', model: 'whisper-1' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const FormStub = {
  name: 'SpeechProviderConfigForm',
  props: ['provider', 'config', 'scope', 'groupId', 'agentId', 'saving'],
  emits: ['saved', 'deleted', 'cancel'],
  template: '<div class="form-stub" :data-scope="scope" :data-group-id="groupId"></div>',
}

const CreateStub = {
  name: 'SpeechProviderCreateForm',
  props: ['scope', 'groupId'],
  emits: ['created', 'cancel'],
  template: '<div class="create-stub"></div>',
}

const ListStub = {
  name: 'SpeechProviderConfigList',
  props: ['scope', 'items'],
  emits: ['select', 'create'],
  template: '<div class="list-stub" :data-scope="scope"><button class="select-btn" @click="$emit(\'select\', { id: 1, provider_class: \'OpenAI\', display_name: \'X\', settings: {}, updated_at: \'2026-01-01\' })">x</button><button class="create-btn" @click="$emit(\'create\')">c</button></div>',
}

describe('GroupSpeechSettingsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(detailStoreMock, freshDetail())
    vi.clearAllMocks()
    providersRef.value = [openAiProvider]
    groupConfigsRef.value = []
    globalConfigsRef.value = []
    preferredSpeechRef.value = null
    loadingConfigsRef.value = false
    savingRef.value = false
    errorRef.value = null
    loadForGroupMock.mockResolvedValue([])
    upsertMock.mockResolvedValue({ id: 1 })
    updateMock.mockResolvedValue({ id: 1 })
    removeMock.mockResolvedValue({ deleted: true })
    setDefaultMock.mockResolvedValue({ id: 1 })
    setPreferredMock.mockResolvedValue({
      provider_class: null,
      scope: 'group',
      group_id: 1,
    })
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'admin@x.com', is_admin: false, roles: ['USER'] },
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads group configs on mount', async () => {
    mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    await flushPromises()
    expect(loadForGroupMock).toHaveBeenCalledWith(1)
  })

  it('renders the empty state for a plain member when no group configs exist', () => {
    groupConfigsRef.value = []
    // Non-admin, non-owner → read-only branch
    detailStoreMock.group = { id: 1, name: 'Eng', principal_id: 10, my_role: 'member' }
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    expect(wrapper.text()).toContain('no speech provider configurations')
  })

  it('renders one list row per cached group config', () => {
    groupConfigsRef.value = [groupConfigRow({ id: 1 }), groupConfigRow({ id: 2, display_name: 'Mistral' })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    const list = wrapper.findComponent(ListStub)
    expect(list.exists()).toBe(true)
    expect(list.props('scope')).toBe('group')
  })

  it('shows the create button only when the caller can edit', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 1 })]
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'a@x.com', is_admin: false, roles: ['USER'] },
    })
    detailStoreMock.group = { id: 1, name: 'Eng', principal_id: 10, my_role: 'member' }
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    expect(wrapper.find('[data-testid="group-speech-create"]').exists()).toBe(false)

    detailStoreMock.group = { id: 1, name: 'Eng', principal_id: 10, my_role: 'owner' }
    await flushPromises()
    const wrapper2 = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    expect(wrapper2.find('[data-testid="group-speech-create"]').exists()).toBe(true)
  })

  it('switches to the create view when the create button is clicked', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 1 })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    await wrapper.find('[data-testid="group-speech-create"]').trigger('click')
    await flushPromises()
    const create = wrapper.findComponent(CreateStub)
    expect(create.exists()).toBe(true)
    expect(create.props('scope')).toBe('group')
    expect(create.props('groupId')).toBe(1)
  })

  it('forwards created() to openEdit', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 1 })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    await wrapper.find('[data-testid="group-speech-create"]').trigger('click')
    await flushPromises()
    const create = wrapper.findComponent(CreateStub)
    const newConfig = groupConfigRow({ id: 99, display_name: 'New' })
    await create.vm.$emit('created', newConfig)
    await flushPromises()
    const form = wrapper.findComponent(FormStub)
    expect(form.exists()).toBe(true)
    expect(form.props('scope')).toBe('group')
    expect(form.props('groupId')).toBe(1)
    expect(form.props('config')).toEqual(newConfig)
  })

  it('opens edit view when a row is selected', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 7, display_name: 'Mistral' })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    const list = wrapper.findComponent(ListStub)
    // The list stub emits select with a synthetic config; route it to
    // openEdit for the actual cached row.
    list.vm.$emit('select', groupConfigRow({ id: 7, display_name: 'Mistral' }))
    await flushPromises()
    const form = wrapper.findComponent(FormStub)
    expect(form.exists()).toBe(true)
    expect(form.props('config').id).toBe(7)
    expect(form.props('scope')).toBe('group')
  })

  it('returns to list view when cancel is emitted', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 7 })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    const list = wrapper.findComponent(ListStub)
    list.vm.$emit('select', groupConfigRow({ id: 7 }))
    await flushPromises()
    const form = wrapper.findComponent(FormStub)
    await form.vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.findComponent(FormStub).exists()).toBe(false)
    expect(wrapper.findComponent(ListStub).exists()).toBe(true)
  })

  it('refreshes the group list after a save', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 7 })]
    loadForGroupMock.mockClear()
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    const list = wrapper.findComponent(ListStub)
    list.vm.$emit('select', groupConfigRow({ id: 7 }))
    await flushPromises()
    const form = wrapper.findComponent(FormStub)
    loadForGroupMock.mockClear()
    await form.vm.$emit('saved')
    await flushPromises()
    expect(loadForGroupMock).toHaveBeenCalledWith(1)
    expect(toastMock.success).toHaveBeenCalledWith('Speech provider configuration updated.')
  })

  it('returns to list and toasts on delete', async () => {
    groupConfigsRef.value = [groupConfigRow({ id: 7 })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    const list = wrapper.findComponent(ListStub)
    list.vm.$emit('select', groupConfigRow({ id: 7 }))
    await flushPromises()
    const form = wrapper.findComponent(FormStub)
    await form.vm.$emit('deleted')
    await flushPromises()
    expect(wrapper.findComponent(ListStub).exists()).toBe(true)
    expect(toastMock.success).toHaveBeenCalledWith('Speech provider configuration deleted.')
  })

  it('surfaces ApiError via toast on mount load failure', async () => {
    loadForGroupMock.mockRejectedValueOnce(new ApiError('boom', 'ERROR', 500))
    mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })

  it('global admins can write regardless of group membership', async () => {
    detailStoreMock.group = { id: 1, name: 'Eng', principal_id: 10, my_role: 'member' }
    useAuthStoreMock.mockReturnValue({
      user: { id: 1, email: 'a@x.com', is_admin: true, roles: ['ADMIN'] },
    })
    groupConfigsRef.value = [groupConfigRow({ id: 7 })]
    const wrapper = mount(GroupSpeechSettingsPage, {
      global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
    })
    expect(wrapper.find('[data-testid="group-speech-create"]').exists()).toBe(true)
  })

  // Preferred STT widget — group scope only. Mirrors the user-scope
  // widget on SpeechProviderConfigsPage, but the setPreferred call
  // includes group_id and scope=group. The dropdown lists this group's
  // own configs first, then global configs as the fallback pool.
  describe('Preferred STT widget', () => {
    const globalConfigRow = (overrides: Record<string, unknown> = {}) => ({
      ...groupConfigRow({ scope: 'global' as const, id: 7, display_name: 'Org-wide Whisper', ...overrides }),
    })

    it('renders the group-scope dropdown with group + global candidates', async () => {
      groupConfigsRef.value = [groupConfigRow({ id: 50, display_name: 'Team Whisper' })]
      globalConfigsRef.value = [globalConfigRow()]
      const wrapper = mount(GroupSpeechSettingsPage, {
        global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
      })
      await flushPromises()
      const select = wrapper.find('[data-testid="group-preferred-stt-select"]')
      expect(select.exists()).toBe(true)
      const optionTexts = select.findAll('option').map((o) => o.text())
      expect(optionTexts).toContain('— Use global default —')
      expect(optionTexts).toContain('Team Whisper')
      expect(optionTexts).toContain('Org-wide Whisper')
    })

    it('calls store.setPreferred with scope=group and the current group_id on Save', async () => {
      groupConfigsRef.value = [groupConfigRow({ id: 50, display_name: 'Team Whisper' })]
      const wrapper = mount(GroupSpeechSettingsPage, {
        global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
      })
      await flushPromises()
      const select = wrapper.find('[data-testid="group-preferred-stt-select"]')
      await select.setValue(OPENAI_CLASS)
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      await saveBtn.trigger('click')
      await flushPromises()
      expect(setPreferredMock).toHaveBeenCalledTimes(1)
      expect(setPreferredMock).toHaveBeenCalledWith({
        provider_class: OPENAI_CLASS,
        scope: 'group',
        group_id: 1,
      })
    })

    it('disables the Save button when the preference is unchanged', async () => {
      groupConfigsRef.value = [groupConfigRow({ id: 50 })]
      preferredSpeechRef.value = {
        provider_class: OPENAI_CLASS,
        scope: 'group',
        group_id: 1,
      }
      const wrapper = mount(GroupSpeechSettingsPage, {
        global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
      })
      await flushPromises()
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      expect(saveBtn.attributes('disabled')).toBeDefined()
    })

    it('surfaces ApiError via toast when the save fails', async () => {
      groupConfigsRef.value = [groupConfigRow({ id: 50 })]
      setPreferredMock.mockRejectedValueOnce(new ApiError('forbidden', 'FORBIDDEN', 403))
      const wrapper = mount(GroupSpeechSettingsPage, {
        global: { stubs: { SpeechProviderConfigList: ListStub, SpeechProviderCreateForm: CreateStub, SpeechProviderConfigForm: FormStub } },
      })
      await flushPromises()
      const select = wrapper.find('[data-testid="group-preferred-stt-select"]')
      await select.setValue(OPENAI_CLASS)
      const saveBtn = wrapper
        .findAll('button')
        .find((b) => (b.text() ?? '').includes('Save preference'))!
      await saveBtn.trigger('click')
      await flushPromises()
      expect(toastMock.error).toHaveBeenCalledWith('forbidden')
    })
  })
})
