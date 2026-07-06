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

export interface ForgotPasswordPayload {
  email: string
}

export interface ResendVerificationPayload {
  email: string
}

export interface ApiConfig {
  allow_registration: boolean
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
