/**
 * A saved address of a principal. The same shape serves a user's own
 * locations and a group's — the owner of the address is the principal, not
 * the kind of principal.
 */
export interface Location {
  id: number
  name: string
  address: string
  is_default: boolean
}

/**
 * The wire body for creating or updating a location. All three fields are
 * always sent: `name` and `address` are required, `is_default` marks the
 * principal's one default address.
 */
export interface LocationPayload {
  name: string
  address: string
  is_default: boolean
}
