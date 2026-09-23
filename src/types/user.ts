import type { ProfilePicture } from './profilePicture'

export interface User {
  id: number
  email: string
  username: string | null
  name: string | null
  is_admin: boolean
  roles: string[]
  verified: boolean
  created_at?: string
  registered?: string
  suspended?: boolean
  /**
   * Profile picture the user uploaded from the Account page.
   * `null` when the user has no upload yet — the SPA renders initials
   * via `Avatar.vue` in that case. Cross-subject shape (same wire
   * contract as agent / group pictures) so the existing `Avatar`
   * component picks it up unchanged.
   */
  profile_picture?: ProfilePicture | null
}

export interface PaginatedUsers {
  users: User[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export interface CreateUserPayload {
  email: string
  password: string
}

export interface UpdateUserPayload {
  username?: string
  name?: string
  is_admin?: boolean
  suspended?: boolean
  verified?: boolean
}
