/**
 * SpeechProviderConfigList — list of speech provider configurations
 * for a given scope.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

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
const personalConfigsRef = ref<typeof configsRef.value>([])
const globalConfigsRef = ref<typeof configsRef.value>([])
const loadingRef = ref(false)

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    get configs() { return configsRef.value },
    get personalConfigs() { return personalConfigsRef.value },
    get globalConfigs() { return globalConfigsRef.value },
    get loadingConfigs() { return loadingRef.value },
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
  scope: 'global' | 'user'
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
  configsRef.value = []
  personalConfigsRef.value = []
  globalConfigsRef.value = []
  loadingRef.value = false
})

describe('SpeechProviderConfigList', () => {
  it('shows a loading state while configs are fetching', () => {
    loadingRef.value = true
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

  it('renders the user-scope configs when scope=user', () => {
    personalConfigsRef.value = [
      sampleConfig({ id: 1, display_name: 'Personal Mistral' }),
      sampleConfig({ id: 2, display_name: 'Personal Whisper' }),
    ]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Personal Mistral')
    expect(wrapper.text()).toContain('Personal Whisper')
    expect(wrapper.text()).toContain('+ Add New')
  })

  it('renders the global-scope configs when scope=global', () => {
    globalConfigsRef.value = [sampleConfig({ id: 7, display_name: 'Mistral Voxtral (prod)', scope: 'global' })]
    personalConfigsRef.value = [sampleConfig({ id: 1, display_name: 'Should be hidden' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'global' } })
    expect(wrapper.text()).toContain('Mistral Voxtral (prod)')
    expect(wrapper.text()).not.toContain('Should be hidden')
  })

  it('emits select with the clicked config', async () => {
    personalConfigsRef.value = [sampleConfig({ id: 7, display_name: 'pick-me' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const row = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('pick-me'))
    expect(row).toBeDefined()
    await row!.trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0][0]).toMatchObject({ id: 7 })
  })

  it('emits create when the "Add New" button is clicked', async () => {
    personalConfigsRef.value = [sampleConfig({ id: 1 })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    const btn = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Add New'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('create')).toBeTruthy()
  })

  it('renders the scope badge for each row', () => {
    personalConfigsRef.value = [sampleConfig({ id: 1, display_name: 'mine', scope: 'user' })]
    const wrapper = mount(SpeechProviderConfigList, { props: { scope: 'user' } })
    expect(wrapper.text()).toContain('Mine')
  })
})
