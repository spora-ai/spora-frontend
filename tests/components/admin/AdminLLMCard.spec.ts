/**
 * AdminLLMCard — single LLM config card.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const putSettingsMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToolSettings', () => ({
  useToolSettings: () => ({ putSettings: putSettingsMock }),
}))

const driver = {
  name: 'openai',
  driver_class: 'OpenAI\\Driver',
  display_name: 'OpenAI',
  settings_schema: [],
  description: 'OpenAI driver',
  is_default: true,
  is_global: false,
}

import AdminLLMCard from '@/components/admin/AdminLLMCard.vue'

describe('AdminLLMCard', () => {
  it('renders the driver display name', () => {
    const wrapper = mount(AdminLLMCard, {
      props: { driver, settings: {}, saving: false, error: null },
    })
    expect(wrapper.text()).toContain('OpenAI')
  })


  it('falls back to the catalogue sentence when the save failure is not an ApiError', async () => {
    // The catch branches on `e instanceof ApiError`; a transport error
    // reaches the catalogue's own sentence instead of the host's message.
    putSettingsMock.mockRejectedValueOnce(new Error('network exploded'))
    const wrapper = mount(AdminLLMCard, {
      props: { driver, settings: {}, saving: false, error: null },
    })
    const vm = wrapper.vm as unknown as {
      localError: string | null
      onSave: (settings: Record<string, string>) => Promise<void>
    }
    await vm.onSave({ api_key: 'k' })
    await flushPromises()
    expect(vm.localError).toBe('Failed to save settings.')
  })

  it('renders the driver heading whether or not it is the default', () => {
    const wrapper = mount(AdminLLMCard, {
      props: { driver: { ...driver, is_default: false }, settings: {}, saving: false, error: null },
    })
    // The default badge belongs to LLMConfigList, so this card's own
    // contribution is its heading.
    expect(wrapper.get('h2').text()).toBe('OpenAI')
  })
})
