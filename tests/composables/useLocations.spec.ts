/**
 * useLocations — pure helpers for the location form.
 */
import { describe, it, expect } from 'vitest'
import {
  applyLocationChanges,
  emptyLocationForm,
  validateLocationForm,
  firstLocationError,
} from '@/composables/useLocations'
import type { Location } from '@/types/location'

const hq: Location = { id: 7, name: 'HQ', address: 'Musterstraße 1', is_default: true }
const branch: Location = { id: 9, name: 'Branch', address: 'Sideweg 2', is_default: false }

describe('useLocations helpers', () => {
  describe('emptyLocationForm', () => {
    it('returns an empty location form', () => {
      expect(emptyLocationForm()).toEqual({
        name: '',
        address: '',
        is_default: false,
      })
    })
  })

  describe('validateLocationForm', () => {
    it('returns errors when name and address are missing', () => {
      const errors = validateLocationForm({ name: '', address: '' })
      expect(errors.name).toBe('Name is required.')
      expect(errors.address).toBe('Address is required.')
    })

    it('errors for whitespace-only values', () => {
      const errors = validateLocationForm({ name: '   ', address: '   ' })
      expect(errors.name).toBe('Name is required.')
      expect(errors.address).toBe('Address is required.')
    })

    it('returns no errors when both fields are filled', () => {
      expect(validateLocationForm({ name: 'Home', address: '1 Main St' })).toEqual({})
    })

    it('only flags the missing field', () => {
      expect(validateLocationForm({ name: 'Home', address: '' })).toEqual({
        address: 'Address is required.',
      })
    })
  })

  describe('firstLocationError', () => {
    it('returns name error first', () => {
      expect(firstLocationError({ name: 'A', address: 'B' })).toBe('A')
    })

    it('returns address error when name is absent', () => {
      expect(firstLocationError({ address: 'B' })).toBe('B')
    })

    it('returns null when no errors', () => {
      expect(firstLocationError({})).toBeNull()
    })
  })

  describe('applyLocationChanges', () => {
    it('returns the list untouched when nothing changed', () => {
      expect(applyLocationChanges([hq], [])).toEqual([hq])
    })

    it('adds an upserted row', () => {
      const berlin: Location = { id: 8, name: 'Berlin', address: 'Alexanderplatz 1', is_default: false }
      expect(applyLocationChanges([hq], [{ kind: 'upsert', row: berlin }])).toEqual([hq, berlin])
    })

    it('replaces a row with the same id instead of listing it twice', () => {
      const renamed: Location = { ...hq, name: 'Headquarters' }
      expect(applyLocationChanges([hq, branch], [{ kind: 'upsert', row: renamed }])).toEqual([renamed, branch])
    })

    it('removes a deleted row', () => {
      expect(applyLocationChanges([hq, branch], [{ kind: 'delete', id: 7 }])).toEqual([branch])
    })

    it('demotes the other rows when the upserted row is the default', () => {
      const berlin: Location = { id: 8, name: 'Berlin', address: 'Alexanderplatz 1', is_default: true }
      const merged = applyLocationChanges([hq, branch], [{ kind: 'upsert', row: berlin }])
      expect(merged.map((l) => l.id)).toEqual([7, 8, 9])
      expect(merged.map((l) => l.is_default)).toEqual([false, true, false])
    })

    it('orders the rows by id, like the server', () => {
      const berlin: Location = { id: 8, name: 'Berlin', address: 'Alexanderplatz 1', is_default: false }
      expect(applyLocationChanges([branch], [{ kind: 'upsert', row: berlin }]).map((l) => l.id)).toEqual([8, 9])
    })
  })
})
