import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AgentSpeechConfigModal from '@/components/agent/AgentSpeechConfigModal.vue'

// Inline Modal stub — renders slot content directly, avoids Teleport
// issues in JSDOM and keeps the contract under test focused on the
// modal ↔ form wiring (the form has its own dedicated spec).
const ModalStub = {
  name: 'Modal',
  props: ['modelValue', 'title', 'size'],
  emits: ['update:modelValue', 'close'],
  template: '<div v-if="modelValue" class="modal-stub"><slot /></div>',
}

// Stub the create form so we can drive its `created` and `cancel` emits
// from the test. The form's internal save pipeline is covered by
// tests/components/settings/speech/SpeechProviderCreateForm.spec.ts.
const SpeechFormStub = {
  name: 'SpeechProviderCreateForm',
  props: ['scope', 'groupId'],
  emits: ['created', 'cancel'],
  template: '<div class="speech-form-stub" data-scope="user"></div>',
}

const newConfig = {
  id: 7,
  provider_class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
  provider_display_name: 'OpenAI Compatible',
  scope: 'user',
  display_name: 'My Whisper',
  settings: { display_name: 'My Whisper' },
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const providers = [
  {
    class: 'Spora\\Speech\\OpenAiCompatibleTranscriber',
    display_name: 'OpenAI Compatible',
    settings_schema: [],
  },
]

describe('AgentSpeechConfigModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('renders the form inside a Modal when show=true', async () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: true, providers },
      global: { stubs: { Modal: ModalStub } },
    })
    await flushPromises()
    expect(wrapper.find('.modal-stub').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).exists()).toBe(true)
  })

  it('does not render anything when show=false', () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: false, providers },
      global: { stubs: { Modal: ModalStub } },
    })
    expect(wrapper.find('.modal-stub').exists()).toBe(false)
  })

  it('passes scope="user" to SpeechProviderCreateForm', async () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: true, providers },
      global: { stubs: { Modal: ModalStub, SpeechProviderCreateForm: SpeechFormStub } },
    })
    await flushPromises()
    expect(wrapper.find('.speech-form-stub').attributes('data-scope')).toBe('user')
  })

  it('forwards the form\'s created event and closes the modal', async () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: true, providers },
      global: { stubs: { Modal: ModalStub, SpeechProviderCreateForm: SpeechFormStub } },
    })
    await flushPromises()
    await wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).vm.$emit('created', newConfig)
    await flushPromises()
    expect(wrapper.emitted('created')).toBeDefined()
    expect(wrapper.emitted('created')![0]).toEqual([newConfig])
    expect(wrapper.emitted('update:show')).toBeDefined()
    expect(wrapper.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('forwards the form\'s cancel as update:show(false)', async () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: true, providers },
      global: { stubs: { Modal: ModalStub, SpeechProviderCreateForm: SpeechFormStub } },
    })
    await flushPromises()
    await wrapper.findComponent({ name: 'SpeechProviderCreateForm' }).vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('re-emits the Modal\'s update:modelValue as update:show', async () => {
    const wrapper = mount(AgentSpeechConfigModal, {
      props: { show: true, providers },
      global: { stubs: { Modal: ModalStub, SpeechProviderCreateForm: SpeechFormStub } },
    })
    await flushPromises()
    await wrapper.findComponent({ name: 'Modal' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.emitted('update:show')!.at(-1)).toEqual([false])
  })
})
