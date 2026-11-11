/**
 * useLocations — pure helpers for the location form and the location list.
 *
 * Shared by every principal-scoped location surface (the profile page and
 * the group settings page) so a location is validated and merged the same
 * way wherever it is edited.
 */
import { i18n } from '@/i18n'
import type { Location, LocationPayload } from '@/types/location'

export type { Location } from '@/types/location'

export type LocationForm = LocationPayload

/**
 * A change the client made to the locations list. A list that arrives
 * after the change carries the older rows, so the change is applied over
 * it rather than the list being discarded — dropping it would take the
 * principal's other locations with it.
 */
export type LocationChange =
  | { kind: 'upsert'; row: Location }
  | { kind: 'delete'; id: number }

/**
 * Per-field validation errors. A field is absent when it is valid, which
 * `firstLocationError` reads as "no error".
 */
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

/**
 * The list with the changes applied over it, ordered by id like the
 * server's own list.
 *
 * The server keeps one default per principal and demotes the previous one
 * when another is promoted — and it does not return the demoted rows, so
 * the list has to show that, or two rows carry the badge until the next
 * reload.
 */
export function applyLocationChanges(
  list: Location[],
  changes: LocationChange[],
): Location[] {
  if (changes.length === 0) return list
  let merged = [...list]
  for (const change of changes) {
    if (change.kind === 'delete') {
      merged = merged.filter((l) => l.id !== change.id)
      continue
    }
    const row = change.row
    merged = merged.filter((l) => l.id !== row.id)
    merged = row.is_default
      ? [...merged.map((l) => ({ ...l, is_default: false })), { ...row }]
      : [...merged, { ...row }]
  }
  return merged.sort((a, b) => a.id - b.id)
}
