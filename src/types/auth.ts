export interface LoginCredentials {
  email: string
  password: string
  remember_me?: boolean
}

export interface RegisterPayload {
  email: string
  password: string
  confirm_password: string
  display_name: string
}

export interface PasswordChangePayload {
  current_password: string
  new_password: string
}

export interface EmailChangePayload {
  email: string
}

/**
 * Response shape from `GET /api/v1/auth/verify/{selector}`. The `kind`
 * discriminator tells the SPA whether the link closes the initial-signup
 * verification (`signup`, no session) or confirms an email-address change
 * (`change`, session is the target user). Mirrors
 * `AuthWorkflow::performEmailVerification` on the backend.
 */
export interface AuthVerifyResponse {
  message: string
  kind: 'signup' | 'change'
  old_email: string | null
  new_email: string
}

export interface ForgotPasswordPayload {
  email: string
}

export interface ResendVerificationPayload {
  email: string
}

export interface ApiConfig {
  allow_registration: boolean
  /**
   * Server-controlled gate for `POST /api/v1/groups`. Mirrors
   * `SPORA_ALLOW_GROUP_CREATION`. When `true` (default), every
   * authenticated caller can create groups — admins via the dedicated
   * admin panel, non-admins via MyGroupsPage. When `false`, only
   * admins can create. The SPA uses this to decide whether to render
   * the "Create group" affordance on MyGroupsPage.
   */
  allow_group_creation: boolean
  /**
   * Server-controlled gate for the Web UI plugin install / uninstall /
   * update endpoints. Mirrors `SPORA_PLUGIN_INSTALL_ENABLED`. Read at
   * runtime via `GET /api/v1/config`; never from a build-time env var.
   */
  plugin_install_enabled: boolean
  /**
   * Server-controlled gate for the Packagist catalog endpoint
   * (`/api/v1/plugins/catalog`). Mirrors `SPORA_PLUGIN_CATALOG_ENABLED`.
   */
  plugin_catalog_enabled: boolean
}
