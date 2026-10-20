/**
 * LocaleSelector — the option list, the current selection, and the two
 * ways a choice can end: the server takes it, or the server refuses it.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message)
    }
  },
  api: { get: vi.fn(), put: vi.fn() },
}))

import { api } from '@/api/client'
import LocaleSelector from '@/components/profile/LocaleSelector.vue'
import { useLocaleStore } from '@/stores/locale'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

describe('LocaleSelector', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mockApi.get.mockReset()
    mockApi.put.mockReset()
    mockApi.put.mockResolvedValue({ locale: 'de' })
  })

  it('offers every locale this build ships, labelled in its own language', () => {
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })
    const options = wrapper.findAll('option')

    // The endonyms do not change with the interface language: a user
    // looking for their language scans for the name they know it by.
    expect(options.map((o) => o.attributes('value'))).toEqual(['automatic', 'de', 'en'])
    expect(options.map((o) => o.text())).toEqual([
      'Automatic (instance default)',
      'Deutsch',
      'English',
    ])
    wrapper.unmount()
  })

  it('names the control it labels', () => {
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })
    const label = wrapper.get('label')
    const select = wrapper.get('select')

    expect(label.attributes('for')).toBe(select.attributes('id'))
    expect(select.attributes('id')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows the stored preference as the current selection', () => {
    const store = useLocaleStore()
    store.preference = 'de'

    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('de')
    wrapper.unmount()
  })

  it('shows "automatic" when the user has no preference of their own', () => {
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('automatic')
    wrapper.unmount()
  })

  it('saves the picked language to the server', async () => {
    const store = useLocaleStore()
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })

    await wrapper.get('select').setValue('de')
    await flushPromises()

    expect(mockApi.put).toHaveBeenCalledWith('/user-preferences/locale', { locale: 'de' })
    expect(store.locale).toBe('de')
    wrapper.unmount()
  })

  it('clears the stored preference when "automatic" is picked', async () => {
    const store = useLocaleStore()
    store.preference = 'de'
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })

    await wrapper.get('select').setValue('automatic')
    await flushPromises()

    expect(mockApi.put).toHaveBeenCalledWith('/user-preferences/locale', { locale: null })
    expect(store.preference).toBeNull()
    wrapper.unmount()
  })

  it('reports a refused save and puts the previous language back', async () => {
    const store = useLocaleStore()
    const wrapper = mount(LocaleSelector, { global: { plugins: [pinia] } })

    await wrapper.get('select').setValue('de')
    await flushPromises()
    expect(store.locale).toBe('de')

    mockApi.put.mockRejectedValueOnce(new Error('boom'))
    await wrapper.get('select').setValue('en')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not save the language preference.')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('de')
    expect(store.locale).toBe('de')
    wrapper.unmount()
  })
})
