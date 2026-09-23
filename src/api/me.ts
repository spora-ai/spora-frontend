import { api } from './client'
import type { ProfilePicture } from '@/types/profilePicture'

/**
 * `/me/*` endpoints — caller-scoped surface for the authenticated user.
 *
 * Used by the AccountPage (`/account`) for self-management: profile
 * picture upload/delete + locations CRUD (the latter still inlined in
 * ProfileSettingsPage). Centralising the calls here so a future
 * profile-settings refactor can swap ProfileSettingsPage to use the
 * same client without duplicating the multipart / cache-buster dance.
 *
 * All three functions unwrap the `{data: ...}` envelope (the shared
 * `api.get` / `api.postForm` / `api.delete` helpers already do it).
 */

export async function getMyProfilePicture(): Promise<ProfilePicture | null> {
  const r = await api.get<{ profile_picture: ProfilePicture | null }>('/me/picture')
  return r.profile_picture
}

export async function uploadMyProfilePicture(file: File): Promise<ProfilePicture> {
  const form = new FormData()
  form.append('file', file)
  const r = await api.postForm<{ profile_picture: ProfilePicture }>('/me/picture/image', form)
  return r.profile_picture
}

export async function deleteMyProfilePicture(): Promise<void> {
  await api.delete<void>('/me/picture/image')
}

/**
 * Read another user's profile picture bytes — used when the SPA needs
 * to surface a picture for a user it doesn't have in the auth store
 * (e.g. group members list, "viewing as another user"). The response
 * is the raw image stream (Content-Type from the row), not JSON, so
 * the caller passes the URL straight to `<img src>` rather than
 * awaiting a parsed body.
 *
 * Returns the URL string; the browser handles the actual fetch via
 * the `<img>` tag's session-cookie credentials.
 *
 * @see Group members list view (planned) — the consumer that needs
 *      cross-user picture URLs. Not exercised in this PR.
 */
export function userProfilePictureUrl(userId: number): string {
  return `/api/v1/users/${userId}/picture`
}
