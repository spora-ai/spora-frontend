/**
 * LocationsSection — the shared location surface.
 *
 * The component owns the list and the add/edit modal; the parent owns the
 * data and the API calls, so these tests assert on the emitted payloads
 * rather than on any request.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import LocationsSection from '@/components/shared/LocationsSection.vue'
import type { Location } from '@/types/location'

const locations: Location[] = [
  { id: 1, name: 'HQ', address: 'Musterstraße 1, 10115 Berlin', is_default: true },
  { id: 2, name: 'Branch', address: 'Sideweg 2, 20095 Hamburg', is_default: false },
]

function mountSection(props: Partial<{
  locations: Location[]
  canEdit: boolean
  loading: boolean
  error: string | null
}> = {}) {
  return mount(LocationsSection, {
    props: {
      locations: props.locations ?? locations,
      canEdit: props.canEdit ?? true,
      loading: props.loading ?? false,
      error: props.error ?? null,
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
  })

  describe('read-only mode', () => {
    it('hides the add button and the per-row actions', () => {
      const wrapper = mountSection({ canEdit: false })
      expect(wrapper.findAll('button')).toHaveLength(0)
      expect(wrapper.text()).toContain('HQ')
    })
  })

  describe('adding a location', () => {
    it('emits create with the form payload', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Berlin')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await wrapper.find('[id="loc-default"]').setValue(true)
      await buttonByText(wrapper, 'Save Location').trigger('click')

      expect(wrapper.emitted('create')).toEqual([
        [{ name: 'Berlin', address: 'Alexanderplatz 1', is_default: true }],
      ])
      expect(wrapper.emitted('update')).toBeUndefined()
    })

    it('refuses to emit while the name is missing', async () => {
      const wrapper = mountSection()
      await buttonByText(wrapper, 'Add location').trigger('click')
      await wrapper.find('[id="loc-address"]').setValue('Alexanderplatz 1')
      await buttonByText(wrapper, 'Save Location').trigger('click')

      expect(wrapper.emitted('create')).toBeUndefined()
      expect(wrapper.text()).toContain('Name is required.')
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
    it('emits update with the location id and the form payload', async () => {
      const wrapper = mountSection()
      const rowButtons = wrapper.findAll('[data-testid="location-row"]')[0].findAll('button')
      await rowButtons[0].trigger('click')

      await wrapper.find('[id="loc-name"]').setValue('Headquarters')
      await buttonByText(wrapper, 'Save Location').trigger('click')

      expect(wrapper.emitted('update')).toEqual([
        [1, { name: 'Headquarters', address: 'Musterstraße 1, 10115 Berlin', is_default: true }],
      ])
      expect(wrapper.emitted('create')).toBeUndefined()
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
