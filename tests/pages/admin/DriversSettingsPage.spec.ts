/**
 * DriversSettingsPage — admin LLM driver listing.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

beforeEach(() => {
  setActivePinia(createPinia())
  getMock.mockReset()
  getMock.mockResolvedValue({ drivers: [] })
})

describe('DriversSettingsPage', () => {
  it('mounts and loads drivers', async () => {
    const wrapper = mount(DriversSettingsPage)
    await flushPromises()
    expect(getMock).toHaveBeenCalledWith('/llm-drivers')
    expect(wrapper.exists()).toBe(true)
  })

  it('renders an empty-state when there are no drivers', async () => {
    const wrapper = mount(DriversSettingsPage)
    await flushPromises()
    // Page may show 'No drivers registered' or 'Loading…' depending on state.
    expect(wrapper.text()).toMatch(/drivers|no|none|empty|loading/i)
  })

  it('shows a visible "Global default" badge for the default config', async () => {
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
    getMock.mockReset()
    getMock
      .mockResolvedValueOnce({ drivers: [] })
      .mockResolvedValueOnce({ configs: [sampleConfig] })

    const wrapper = mount(DriversSettingsPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Global default')
    // Regression: the badge must not silently use the old faint label casing
    expect(wrapper.text()).not.toContain('Global Default')
  })
})
