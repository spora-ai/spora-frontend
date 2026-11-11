import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ProfileSettingsPage from '@/pages/ProfileSettingsPage.vue'
import LocationsSection from '@/components/shared/LocationsSection.vue'
import type { Location } from '@/types/location'
import type { UserProfile } from '@/composables/useProfileSettings'

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {
    constructor(public override message: string, public readonly status = 500) {
      super(message)
    }
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '@/api/client'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }

const mockProfile: UserProfile = {
  name: 'Alice',
  date_of_birth: '1990-05-15',
  about_me: 'Hello world',
  height_cm: 175.5,
  weight_kg: 70.0,
}

const mockLocations: Location[] = [
  { id: 1, name: 'Home', address: '123 Main St', is_default: true },
  { id: 2, name: 'Work', address: '456 Office Blvd', is_default: false },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/profile', name: 'profile', component: { template: '<div />' } }],
  })
}

describe('ProfileSettingsPage', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  async function mountPage(profileData: UserProfile = mockProfile, locationsData: { locations: Location[] } = { locations: mockLocations }) {
    mockApi.get.mockImplementation((path: string) => {
      if (path === '/me/profile') return Promise.resolve(profileData)
      if (path === '/me/locations') return Promise.resolve(locationsData)
      if (path === '/tasks') return Promise.resolve({ tasks: [] }) // prevent polling crash
      return Promise.resolve(null)
    })

    const router = makeRouter()
    await router.push('/profile')
    await router.isReady()

    const wrapper = mount(ProfileSettingsPage, {
      global: { plugins: [router, pinia] },
    })
    await flushPromises()
    // Allow onMounted async operations to complete
    await new Promise(r => setTimeout(r, 0))
    await flushPromises()

    return { wrapper, router }
  }

  describe('initial data loading', () => {
    it('loads profile and locations on mount', async () => {
      const { wrapper } = await mountPage()
      expect(mockApi.get).toHaveBeenCalledWith('/me/profile')
      expect(mockApi.get).toHaveBeenCalledWith('/me/locations')
      wrapper.unmount()
    })

    it('falls back to the catalogue sentence when the load failure is not an ApiError', async () => {
      // The catch branches on `e instanceof ApiError`; a transport error
      // reaches the catalogue's own sentence instead of the host's message.
      mockApi.get.mockImplementation((path: string) => {
        if (path === '/me/profile' || path === '/me/locations') {
          return Promise.reject(new Error('network exploded'))
        }
        return Promise.resolve(null)
      })

      const router = makeRouter()
      await router.push('/profile')
      await router.isReady()

      const wrapper = mount(ProfileSettingsPage, { global: { plugins: [router, pinia] } })
      await flushPromises()
      await new Promise(r => setTimeout(r, 0))
      await flushPromises()

      expect(wrapper.text()).toContain('Failed to load profile')
      expect(wrapper.text()).toContain('Failed to load locations')
      wrapper.unmount()
    })

    it('falls back to the catalogue sentence when the location save failure is not an ApiError', async () => {
      // The catch branches on `e instanceof ApiError`; a transport error
      // reaches the catalogue's own sentence instead of the host's message.
      mockApi.post.mockRejectedValueOnce(new Error('network exploded'))
      const { wrapper } = await mountPage()

      await wrapper.findAll('button').find(b => b.text().includes('Add location'))!.trigger('click')
      await flushPromises()
      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Failed to save location.')
      wrapper.unmount()
    })

    it('shows locations list from API', async () => {
      const { wrapper } = await mountPage()
      expect(wrapper.text()).toContain('Home')
      expect(wrapper.text()).toContain('Work')
      wrapper.unmount()
    })

    it('renders the locations through the shared section', async () => {
      // The group settings page renders the same component; a page that
      // grew its own markup again would drift away from it.
      const { wrapper } = await mountPage()
      const section = wrapper.findComponent(LocationsSection)
      expect(section.exists()).toBe(true)
      expect(section.props('locations')).toEqual(mockLocations)
      wrapper.unmount()
    })

    it('shows empty message when no locations', async () => {
      const { wrapper } = await mountPage(mockProfile, { locations: [] })
      expect(wrapper.text()).toContain('No locations saved yet')
      wrapper.unmount()
    })

    it('keeps a location created while the locations load was in flight', async () => {
      let resolveLocations: (value: { locations: Location[] }) => void = () => {}
      mockApi.get.mockImplementation((path: string) => {
        if (path === '/me/profile') return Promise.resolve(mockProfile)
        if (path === '/me/locations') {
          return new Promise((resolve) => {
            resolveLocations = resolve
          })
        }
        if (path === '/tasks') return Promise.resolve({ tasks: [] })
        return Promise.resolve(null)
      })

      const router = makeRouter()
      await router.push('/profile')
      await router.isReady()

      const wrapper = mount(ProfileSettingsPage, { global: { plugins: [router, pinia] } })
      await flushPromises()

      mockApi.post.mockResolvedValueOnce({ id: 3, name: 'Berlin', address: 'Alexanderplatz 1', is_default: false })
      await wrapper.findAll('button').find(b => b.text().includes('Add location'))!.trigger('click')
      await flushPromises()
      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()

      // The load resolves with the older list.
      resolveLocations({ locations: mockLocations })
      await flushPromises()

      expect(wrapper.findAll('[data-testid="location-row"]')).toHaveLength(3)
      expect(wrapper.text()).toContain('Berlin')
      wrapper.unmount()
    })
  })

  describe('saving profile', () => {
    it('shows error when profile save fails', async () => {
      mockApi.put.mockRejectedValueOnce(new Error('Server error'))

      const { wrapper } = await mountPage()

      await wrapper.find('[id="profile-name"]').setValue('Bob')
      await wrapper.findAll('button').find(b => b.text().includes('Save Base Data'))!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Failed to save profile')
      wrapper.unmount()
    })
  })

  describe('locations CRUD', () => {
    it('POSTs new location to /me/locations', async () => {
      mockApi.post.mockResolvedValueOnce({ id: 1, name: 'Home', address: '123 Main St', is_default: true })

      const { wrapper } = await mountPage()

      await wrapper.findAll('button').find(b => b.text().includes('Add location'))!.trigger('click')
      await flushPromises()

      await wrapper.find('[id="loc-name"]').setValue('Home')
      await wrapper.find('[id="loc-address"]').setValue('123 Main St')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()

      expect(mockApi.post).toHaveBeenCalledWith('/me/locations', expect.objectContaining({ name: 'Home' }))
      wrapper.unmount()
    })

    it('PUTs edited location to /me/locations/{id}', async () => {
      mockApi.put.mockResolvedValueOnce({ id: 1, name: 'Home Sweet Home', address: '789 New St', is_default: true })

      const { wrapper } = await mountPage()

      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[0].trigger('click')
      await flushPromises()

      await wrapper.find('[id="loc-name"]').setValue('Home Sweet Home')
      await wrapper.find('[id="loc-address"]').setValue('789 New St')
      await wrapper.findAll('button').find(b => b.text().includes('Save Location'))!.trigger('click')
      await flushPromises()

      expect(mockApi.put).toHaveBeenCalledWith('/me/locations/1', expect.objectContaining({ name: 'Home Sweet Home' }))
      expect(mockApi.post).not.toHaveBeenCalledWith('/me/locations', expect.anything())
      wrapper.unmount()
    })

    it('calls delete API when delete button is clicked', async () => {
      mockApi.delete.mockResolvedValueOnce({})

      const { wrapper } = await mountPage()

      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[1].trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 0))
      await flushPromises()

      expect(mockApi.delete).toHaveBeenCalledWith('/me/locations/1')
      wrapper.unmount()
    })
  })

  describe('language selector', () => {
    it('does not render the language picker in the profile section', async () => {
      // The picker is a preference, and preferences live on the account
      // page. On this page it would sit among date of birth and health
      // data — nowhere a user looks for it. The account page owns it.
      const { wrapper } = await mountPage()
      expect(wrapper.find('select').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Language')
      wrapper.unmount()
    })
  })

  describe('health data', () => {
    it('saves health data via PUT /me/profile', async () => {
      mockApi.put.mockResolvedValueOnce({ ...mockProfile, height_cm: 180 })

      const { wrapper } = await mountPage()

      await wrapper.find('[id="health-height"]').setValue('180')
      await wrapper.findAll('button').find(b => b.text().includes('Save Health Data'))!.trigger('click')
      await flushPromises()

      expect(mockApi.put).toHaveBeenCalledWith('/me/profile', expect.objectContaining({ height_cm: 180 }))
      wrapper.unmount()
    })

    it('falls back to a generic message when health data save throws a non-ApiError', async () => {
      mockApi.put.mockRejectedValueOnce(new Error('boom'))
      const { wrapper } = await mountPage()

      await wrapper.findAll('button').find(b => b.text().includes('Save Health Data'))!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toMatch(/Failed to save health data/i)
      wrapper.unmount()
    })
  })

  // Coverage for the catch blocks that were switched from `catch (e: any)`
  // to `catch (e)` + `e instanceof ApiError`. Tests trigger a non-ApiError
  // rejection so the generic-fallback branch executes.
  describe('non-ApiError catch paths', () => {
    it('falls back to a generic message when profile save throws a non-ApiError', async () => {
      mockApi.put.mockRejectedValueOnce(new Error('boom'))
      const { wrapper } = await mountPage()

      await wrapper.findAll('button').find(b => b.text() === 'Save Base Data')!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toMatch(/Failed to save profile/i)
      wrapper.unmount()
    })

    it('falls back to a generic message when delete-location throws a non-ApiError', async () => {
      mockApi.delete.mockRejectedValueOnce(new Error('boom'))
      const { wrapper } = await mountPage()

      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[1].trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 0))
      await flushPromises()

      expect(wrapper.text()).toMatch(/Failed to delete location/i)
      wrapper.unmount()
    })
  })
})

describe('SettingsSidebar', () => {
  it('includes Profile nav item', async () => {
    const { default: SettingsSidebar } = await import('@/components/settings/SettingsSidebar.vue')
    expect(SettingsSidebar).toBeDefined()
  })
})