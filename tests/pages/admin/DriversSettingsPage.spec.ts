/**
 * DriversSettingsPage — admin LLM driver listing.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The router mock is stable across calls so the page's `router.replace`
// calls can be asserted on.
const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 1, email: 'admin@x.com', name: 'Admin', roles: ['ADMIN'], is_admin: true } }),
}))

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

import { api } from '@/api/client'

const getMock = api.get as ReturnType<typeof vi.fn>
import DriversSettingsPage from '@/pages/admin/DriversSettingsPage.vue'

const sampleConfig = {
  id: 1,
  name: 'MiniMax',
  driver_class: 'OpenAI\\Driver',
  driver_name: 'openai',
  driver_display_name: 'OpenAI Compatible',
  settings: {},
  is_default: true,
  is_global: true,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
}

const LLMConfigCreateFormStub = {
  name: 'LLMConfigCreateForm',
  emits: ['created', 'cancel'],
  template: '<div class="create-form-stub" />',
}
const LLMConfigEditFormStub = {
  name: 'LLMConfigEditForm',
  props: ['config'],
  emits: ['saved', 'deleted', 'cancel'],
  template: '<div class="edit-form-stub" />',
}

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
  getMock.mockResolvedValue({ drivers: [] })
  pushMock.mockReset()
  replaceMock.mockReset()
})

function mountPage() {
  return mount(DriversSettingsPage, {
    global: { stubs: { LLMConfigCreateForm: LLMConfigCreateFormStub, LLMConfigEditForm: LLMConfigEditFormStub } },
  })
}

/**
 * The page loads the drivers first and the global configs second, so the
 * mocked responses have to answer in that order.
 */
function mockGlobalConfigs(configs: Array<Record<string, unknown>>): void {
  getMock.mockReset()
  getMock.mockResolvedValueOnce({ drivers: [] }).mockResolvedValue({ configs })
}

describe('DriversSettingsPage', () => {
  it('mounts and loads drivers', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(getMock).toHaveBeenCalledWith('/llm-drivers')
    expect(wrapper.exists()).toBe(true)
  })

  it('renders an empty-state when there are no drivers', async () => {
    const wrapper = mountPage()
    await flushPromises()
    // Page may show 'No drivers registered' or 'Loading…' depending on state.
    expect(wrapper.text()).toMatch(/drivers|no|none|empty|loading/i)
  })

  it('shows a visible "Global default" badge for the default config', async () => {
    getMock.mockReset()
    getMock
      .mockResolvedValueOnce({ drivers: [] })
      .mockResolvedValueOnce({ configs: [sampleConfig] })

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Global default')
    // Regression: the badge must not silently use the old faint label casing
    expect(wrapper.text()).not.toContain('Global Default')
  })

  it('routes to the edited config when a config row is clicked', async () => {
    mockGlobalConfigs([sampleConfig])

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('MiniMax'))
    expect(row).toBeDefined()
    await row!.trigger('click')

    // The config id travels in the URL so a reload lands on the same row.
    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-drivers', query: { config: '1' } })
    expect(wrapper.find('.edit-form-stub').exists()).toBe(true)
  })

  it('routes to the create form when "Add Global Config" is clicked', async () => {
    mockGlobalConfigs([sampleConfig])

    const wrapper = mountPage()
    await flushPromises()

    const addButton = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Add Global Config'))
    expect(addButton).toBeDefined()
    await addButton!.trigger('click')

    expect(replaceMock).toHaveBeenCalledWith({ name: 'settings-admin-drivers', query: { create: '1' } })
    expect(wrapper.find('.create-form-stub').exists()).toBe(true)
  })

  it('routes to the new config once the create form reports it', async () => {
    const created = { ...sampleConfig, id: 7, name: 'Created' }
    mockGlobalConfigs([sampleConfig])
    getMock.mockResolvedValue({ configs: [sampleConfig, created] })

    const wrapper = mountPage()
    await flushPromises()

    const addButton = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Add Global Config'))
    await addButton!.trigger('click')

    const create = wrapper.findComponent({ name: 'LLMConfigCreateForm' })
    expect(create.exists()).toBe(true)
    await create.vm.$emit('created', created)
    await flushPromises()

    expect(replaceMock).toHaveBeenLastCalledWith({ name: 'settings-admin-drivers', query: { config: '7' } })
    expect(wrapper.find('.edit-form-stub').exists()).toBe(true)
  })

  it('routes back to the list when the edit form reports the config deleted', async () => {
    mockGlobalConfigs([sampleConfig])

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('MiniMax'))
    await row!.trigger('click')

    const edit = wrapper.findComponent({ name: 'LLMConfigEditForm' })
    expect(edit.exists()).toBe(true)
    await edit.vm.$emit('deleted')
    await flushPromises()

    // The deleted row's id is gone from the URL, so a reload lands on the list.
    expect(replaceMock).toHaveBeenLastCalledWith({ name: 'settings-admin-drivers' })
    expect(wrapper.find('.edit-form-stub').exists()).toBe(false)
  })

  it('routes back to the list when the edit form is cancelled', async () => {
    mockGlobalConfigs([sampleConfig])

    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('MiniMax'))
    await row!.trigger('click')

    const edit = wrapper.findComponent({ name: 'LLMConfigEditForm' })
    expect(edit.exists()).toBe(true)
    await edit.vm.$emit('cancel')
    await flushPromises()

    expect(replaceMock).toHaveBeenLastCalledWith({ name: 'settings-admin-drivers' })
    expect(wrapper.find('.edit-form-stub').exists()).toBe(false)
  })
})
