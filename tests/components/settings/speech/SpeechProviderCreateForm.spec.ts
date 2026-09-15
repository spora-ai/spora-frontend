/**
 * SpeechProviderCreateForm — provider-class picker that hands off to
 * SpeechProviderConfigForm for the chosen class.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const providersRef = ref<Array<{
  class: string
  display_name: string
  settings_schema: Array<{
    key: string
    label: string
    type: string
    required?: boolean
    default?: string | null
    validation?: string
  }>
}>>([])
const loadingProvidersRef = ref(false)

const FormStub = {
  name: 'SpeechProviderConfigForm',
  emits: ['saved', 'cancel'],
  template: '<div class="form-stub" />',
}

vi.mock('@/stores/speechProviderConfigs', () => ({
  useSpeechProviderConfigsStore: () => ({
    get providers() { return providersRef.value },
    get loadingProviders() { return loadingProvidersRef.value },
  }),
}))

import SpeechProviderCreateForm from '@/components/settings/speech/SpeechProviderCreateForm.vue'

const openAiProvider = {
  class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
  display_name: 'OpenAI Compatible',
  settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
}

const museProvider = {
  class: 'Spora\\Plugins\\Muse\\MuseTranscribeProvider',
  display_name: 'Meta Muse Voice Transcribe',
  settings_schema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
}

beforeEach(() => {
  setActivePinia(createPinia())
  providersRef.value = []
  loadingProvidersRef.value = false
})

function mountCreate(props: { scope?: 'user' | 'global' } = {}) {
  return mount(SpeechProviderCreateForm, {
    props: { scope: props.scope ?? 'user' },
    global: { stubs: { SpeechProviderConfigForm: FormStub } },
  })
}

describe('SpeechProviderCreateForm', () => {
  it('renders the provider picker with one card per known class', () => {
    providersRef.value = [openAiProvider, museProvider]
    const wrapper = mountCreate()
    expect(wrapper.text()).toContain('OpenAI Compatible')
    expect(wrapper.text()).toContain('Meta Muse Voice Transcribe')
  })

  it('shows a loading state while the schema is being fetched', () => {
    loadingProvidersRef.value = true
    const wrapper = mountCreate()
    expect(wrapper.text()).toContain('Loading')
  })

  it('emits cancel when the bottom Cancel button is clicked in the picker', async () => {
    providersRef.value = [openAiProvider]
    const wrapper = mountCreate()
    // The top "← All configurations" link was removed from the create
    // flow (see SpeechProviderCreateForm.vue); the bottom Cancel button
    // is now the single, predictable way out of the picker.
    const cancel = wrapper.findAll('button').find((b) => (b.text() ?? '').trim() === 'Cancel')!
    await cancel.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('does not render the top "← All configurations" link', () => {
    // The duplicate top back link was removed from the create flow.
    // SpeechProviderConfigForm's inner back button is also gated by
    // `isEdit`, so the create flow has a single Cancel button at the
    // bottom (matches LLMConfigCreateForm).
    providersRef.value = [openAiProvider]
    const wrapper = mountCreate()
    const allConfigurations = wrapper.findAll('button').find(
      (b) => (b.text() ?? '').trim() === '← All configurations',
    )
    expect(allConfigurations).toBeUndefined()
  })

  it('keeps the inner "Pick a different provider" link inside the form flow', async () => {
    // The inner SpeechProviderConfigForm (in create mode) renders its
    // own "← Pick a different provider" link between the picker and the
    // schema form — this is the equivalent of the LLM driver's
    // <select> for changing the driver class, not redundant. The link
    // only appears after the user picks a class.
    providersRef.value = [openAiProvider, museProvider]
    const wrapper = mountCreate()
    const card = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('OpenAI Compatible'))!
    await card.trigger('click')
    await flushPromises()
    const pickAnother = wrapper.findAll('button').find(
      (b) => (b.text() ?? '').includes('Pick a different provider'),
    )
    expect(pickAnother).toBeDefined()
  })

  it('reveals the schema-driven form when a provider card is clicked', async () => {
    providersRef.value = [openAiProvider]
    const wrapper = mountCreate()
    const card = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('OpenAI Compatible'))!
    await card.trigger('click')
    await flushPromises()
    expect(wrapper.find('.form-stub').exists()).toBe(true)
  })

  it('hides the picker while the form is showing', async () => {
    providersRef.value = [openAiProvider]
    const wrapper = mountCreate()
    const card = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('OpenAI Compatible'))!
    await card.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Meta Muse Voice Transcribe')
  })

  it('returns to the picker when "Pick a different provider" is clicked', async () => {
    providersRef.value = [openAiProvider, museProvider]
    const wrapper = mountCreate()
    const card = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('OpenAI Compatible'))!
    await card.trigger('click')
    await flushPromises()
    const back = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('Pick a different provider'))!
    await back.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Meta Muse Voice Transcribe')
    expect(wrapper.find('.form-stub').exists()).toBe(false)
  })

  it('emits created with the new config after the form saves', async () => {
    providersRef.value = [openAiProvider]
    const wrapper = mountCreate()
    const card = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('OpenAI Compatible'))!
    await card.trigger('click')
    await flushPromises()
    const form = wrapper.findComponent({ name: 'SpeechProviderConfigForm' })
    await form.vm.$emit('saved', { id: 42, provider_class: openAiProvider.class, display_name: 'X' })
    expect(wrapper.emitted('created')).toBeTruthy()
    expect(wrapper.emitted('created')![0][0]).toMatchObject({ id: 42 })
  })

  it('renders a placeholder when no providers are registered', () => {
    providersRef.value = []
    const wrapper = mountCreate()
    expect(wrapper.text()).toContain('No speech provider classes are registered')
  })
})
