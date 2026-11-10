/**
 * useProfileSettings — pure helpers for ProfileSettingsPage.
 *
 * Owns the profile form shape. The locations live in `useLocations`, shared
 * with the group settings page.
 */

export interface UserProfile {
  name: string | null
  date_of_birth: string | null
  about_me: string | null
  height_cm: number | null
  weight_kg: number | null
}

/** Empty profile form for the initial render. */
export function emptyProfile(): UserProfile {
  return {
    name: null,
    date_of_birth: null,
    about_me: null,
    height_cm: null,
    weight_kg: null,
  }
}
