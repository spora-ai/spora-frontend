/**
 * LocationsSection — the shared location surface.
 *
 * The props are the seam between the component and the parent, so these
 * tests assert on what the component asks the parent to write rather than
 * on any request.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import LocationsSection from '@/components/shared/LocationsSection.vue'
import type { Location } from '@/types/location'

const locations: Location[] = [
  { id: 1, name: 'HQ', address: 'Musterstraße 1, 10115 Berlin', is_default: true },
  { id: 2, name: 'Branch', address: 'Sideweg 2, 20095 Hamburg', is_default: false },
]

const createLocation = vi.fn()
const updateLocation = vi.fn()

function mountSection(props: Partial<{
  locations: Location[]
  canEdit: boolean
  loading: boolean
  error: string | null
}> = {}) {
  createLocation.mockReset()
  updateLocation.mockReset()
  createLocation.mockResolvedValue(undefined)
  updateLocation.mockResolvedValue(undefined)

  return mount(LocationsSection, {
    props: {
      locations: props.locations ?? locations,
      canEdit: props.canEdit ?? true,
      loading: props.loading ?? false,
      error: props.error ?? null,
      createLocation,
      updateLocation,
    },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountSection>, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text().includes(text))
  expect(button).toBeDefined()
  return button!
}

describe('LocationsSection', () => {
  describe('list', () => {
    it('renders every location with its address', () => {
      const wrapper = mountSection()
      expect(wrapper.text()).toContain('HQ')
      expect(wrapper.text()).toContain('Musterstraße 1, 10115 Berlin')
      expect(wrapper.text()).toContain('Branch')
    })

    it('marks the default location', () => {
      const wrapper = mountSection()
      expect(wrapper.text()).toContain('default')
    })

    it('shows the empty message when there are no locations', () => {
      const wrapper = mountSection({ locations: [] })
      expect(wrapper.text()).toContain('No locations saved yet.')
    })

    it('shows the loading state instead of the list', () => {
      const wrapper = mountSection({ loading: true })
      expect(wrapper.text()).toContain('Loading…')
      expect(wrapper.text()).not.toContain('HQ')
    })

    it('shows the error the parent reported', () => {
      const wrapper = mountSection({ error: 'Server exploded' })
      expect(wrapper.text()).toContain('Server exploded')
    })

    it('reports a failed save once, in the modal', async () => {
      const wrapper = mountSection({ error: 'Server exploded' })
      createLocation.mockRejectedValue(new Error('Server exploded'))
      await buttonByText(wrapper, 'Add location').trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
    })

    it('shows a failure that arrives while the modal is open', async () => {
      const wrapper = mountSection({ error: null })
      await buttonByText(wrapper, 'Add location').trigger('click')
      await wrapper.setProps({ error: 'Delete failed' })

      expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
      expect(wrapper.text()).toContain('Delete failed')
    })
  })

  describe('read-only mode', () => {
    it('hides the add button and the per-row actions', () => {
      const wrapper = mountSection({ canEdit: false })
      expect(wrapper.findAll('button')).toHaveLength(0)
      expect(wrapper.text()).toContain('HQ')
    })
  })

  describe('adding a location', () => {
    it('asks the parent to create the location with the form payload', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await wrapper.find('[id="loc-default"]').setValue(true)
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(createLocation).toHaveBeenCalledWith({
        name: 'Berlin',
        address: 'Alexanderplatz 1',
        is_default: true,
      })
      expect(updateLocation).not.toHaveBeenCalled()
    })

    it('closes the modal once the write resolved', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')
      expect(wrapper.find('[id="loc-name"]').exists()).toBe(true)

      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(wrapper.find('[id="loc-name"]').exists()).toBe(false)
    })

    it('refuses to write while the name is missing', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(createLocation).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Name is required.')
    })

    it('keeps the modal open and shows the failure when the write failed', async () => {
      const wrapper = mountSection()
      createLocation.mockRejectedValue(new Error('Server exploded'))
      await buttonByText(wrapper, 'Add location').trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(wrapper.find('[id="loc-name"]').exists()).toBe(true)
      expect((wrapper.find('[id="loc-name"]').element as HTMLInputElement).value).toBe('Berlin')
      expect(wrapper.text()).toContain('Server exploded')
    })

    it('closes the modal on cancel', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')
      expect(wrapper.find('[id="loc-name"]').exists()).toBe(true)

      await buttonByText(wrapper, 'Cancel').trigger('click')
      expect(wrapper.find('[id="loc-name"]').exists()).toBe(false)
    })
  })

  describe('editing a location', () => {
    it('asks the parent to update the location id with the form payload', async () => {
      const wrapper = mountSection()
      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[0].trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Headquarters')
      await buttonByText(wrapper, 'Save Location').trigger('click')
      await flushPromises()

      expect(updateLocation).toHaveBeenCalledWith(1, {
        name: 'Headquarters',
        address: 'Musterstraße 1, 10115 Berlin',
        is_default: true,
      })
      expect(createLocation).not.toHaveBeenCalled()
    })
  })

  describe('deleting a location', () => {
    it('emits delete with the location id', async () => {
      const wrapper = mountSection()
      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[1].findAll('button')
      await rowButtons[1].trigger('click')

      expect(wrapper.emitted('delete')).toEqual([[2]])
    })
  })
})
