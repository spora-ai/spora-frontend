/**
 * useLocations — pure helpers for the location form.
 *
 * Shared by every principal-scoped location surface (the profile page and
 * the group settings page) so a location is validated the same way wherever
 * it is edited.
 */
import { i18n } from '@/i18n'
import type { LocationPayload } from '@/types/location'

export type { Location } from '@/types/location'

export type LocationForm = LocationPayload

export interface LocationFormErrors {
  name?: string
  address?: string
}

/** Empty location form for the "add location" modal. */
export function emptyLocationForm(): LocationForm {
  return { name: '', address: '', is_default: false }
}

/** Validate the location form, returning a per-field error map. */
export function validateLocationForm(form: {
  name: string
  address: string
}): LocationFormErrors {
  const errors: LocationFormErrors = {}
  if (!form.name.trim()) errors.name = i18n.global.t('Name is required.')
  if (!form.address.trim()) errors.address = i18n.global.t('Address is required.')
  return errors
}

/** First error message in a per-field map, or null. */
export function firstLocationError(errors: LocationFormErrors): string | null {
  return errors.name ?? errors.address ?? null
}
