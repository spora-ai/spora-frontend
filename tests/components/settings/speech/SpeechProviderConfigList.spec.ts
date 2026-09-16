/**
 * SpeechProviderConfigList — list of speech provider configurations
 * for a given scope. Reads from the per-principal slot keyed by the
 * `principalKey` prop (defaults to `'user'`).
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

type SlotKey = number | 'user'

interface Slot {
  configs: Array<{
    id: number
    provider_class: string
    provider_display_name: string
    scope: 'global' | 'user' | 'group'
    display_name: string
    settings: Record<string, string>
    created_at: string
    updated_at: string
  }>
  loadingConfigs: boolean
}

const slots = reactive(new Map<SlotKey, Slot>())

function getSlot(key: SlotKey): Slot {
  let slot = slots.get(key)
  if (!slot) {
    slot = reactive<Slot>({ configs: [], loadingConfigs: false })
    slots.set(key, slot)
  }
  return slot
}

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    getSlot,
  }),
}))

vi.mock('lucide-vue-next', () => ({
  ChevronRight: { template: '<span data-testid="chevron" />' },
}))

import SpeechProviderConfigList from '@/components/settings/speech/SpeechProviderConfigList.vue'

const sampleConfig = (overrides: Partial<{
  id: number
  provider_class: string
  provider_display_name: string
  scope: 'global' | 'user' | 'group'
  display_name: string
  settings: Record<string, string>
  created_at: string
  updated_at: string
}> = {}) => ({
  id: 1,
  provider_class: 'X',
  provider_display_name: 'OpenAI Compatible',
  scope: 'user' as const,
  display_name: 'My STT',
  settings: { api_key: '***' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
  ...overrides,
})

beforeEach(() => {
  setActivePinia(createPinia())
  slots.clear()
})

describe('SpeechProviderConfigList', () => {
  it('shows a loading state while the active slot is fetching configs', () => {
    getSlot('user').loadingConfigs = true
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Loading')
  })

  it('shows an empty-state CTA when no configs match the scope', () => {
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Set up your first provider')
  })

  it('emits create when the empty-state CTA is clicked', async () => {
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const btn = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Set up your first provider'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('create')).toBeTruthy()
  })

  it("renders the user-scope configs from the 'user' slot when scope=user", () => {
    getSlot('user').configs = [
      sampleConfig({ id: 1, display_name: 'Personal Mistral', scope: 'user' }),
      sampleConfig({ id: 2, display_name: 'Personal Whisper', scope: 'user' }),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Personal Mistral')
    expect(wrapper.text()).toContain('Personal Whisper')
    expect(wrapper.text()).toContain('+ Add New')
  })

  it("filters the 'user' slot by scope=global when scope=global (admin page)", () => {
    getSlot('user').configs = [
      sampleConfig({ id: 7, display_name: 'Mistral Voxtral (prod)', scope: 'global' }),
      sampleConfig({ id: 1, display_name: 'Should be hidden', scope: 'user' }),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'global' } })
    expect(wrapper.text()).toContain('Mistral Voxtral (prod)')
    expect(wrapper.text()).not.toContain('Should be hidden')
  })

  it("reads group configs from a numeric principalKey slot when scope=group", () => {
    getSlot(7).configs = [
      sampleConfig({ id: 50, display_name: 'Team Whisper', scope: 'group' }),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'group', principalKey: 7 } })
    expect(wrapper.text()).toContain('Team Whisper')
  })

  it("does not pollute other slots when reading via principalKey", () => {
    getSlot(7).configs = [sampleConfig({ id: 50, display_name: 'Team Whisper', scope: 'group' })]
    // The 'user' slot holds nothing — the list scoped to group 7
    // should not surface any unscoped configs.
    mount(SpeechProviderConfigList, { props: { scope: 'group', principalKey: 7 } })
    expect(getSlot('user').configs).toEqual([])
  })

  it('reads loadingConfigs from the active principalKey slot, not the unscoped slot', () => {
    getSlot('user').loadingConfigs = false
    getSlot(7).loadingConfigs = true
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'group', principalKey: 7 } })
    expect(wrapper.text()).toContain('Loading')
  })

  it('emits select with the clicked config', async () => {
    getSlot('user').configs = [sampleConfig({ id: 7, display_name: 'pick-me', scope: 'user' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const row = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('pick-me'))
    expect(row).toBeDefined()
    await row!.trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0][0]).toMatchObject({ id: 7 })
  })

  it('emits create when the "Add New" button is clicked', async () => {
    getSlot('user').configs = [sampleConfig({ id: 1, scope: 'user' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const btn = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Add New'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('create')).toBeTruthy()
  })

  it('renders the scope badge for each row', () => {
    getSlot('user').configs = [sampleConfig({ id: 1, display_name: 'mine', scope: 'user' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Mine')
  })

  it('renders the Default badge for is_default=true rows', () => {
    // The badge sits next to the scope badge. We only render the badge
    // when the server marked the row as the default — rows with
    // is_default=false stay clean so the list view doesn't get noisy.
    getSlot('user').configs = [
      sampleConfig({ id: 7, display_name: 'Default Mistral', is_default: true } as Partial<ReturnType<typeof sampleConfig>>),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const badge = wrapper.find('[data-testid="default-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Default')
  })

  it('does not render the Default badge for is_default=false rows', () => {
    getSlot('user').configs = [
      sampleConfig({ id: 8, display_name: 'Not Default', is_default: false } as Partial<ReturnType<typeof sampleConfig>>),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.find('[data-testid="default-badge"]').exists()).toBe(false)
  })

  it("renders the agent-scope rows from the `items` prop (bypasses the store)", () => {
    const items = [sampleConfig({ id: 200, display_name: 'Agent override', scope: 'global' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'agent', items } })
    expect(wrapper.text()).toContain('Agent override')
  })
})
