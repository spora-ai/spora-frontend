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

/**
 * Browser-side worker configuration returned by `GET /api/v1/config`
 * when `worker_runtime_mode === 'client'`. Mirrors the keys exposed
 * by `ConfigController::index()` (spora-core) for the
 * client-runtime. The tick endpoint template uses `{taskId}` which
 * `clientTaskWorkerCore` substitutes per call — keeping it as a
 * template avoids hard-coding the path in two places when the
 * routing changes.
 */
export interface ClientWorkerConfig {
  enabled: boolean
  tick_endpoint: string
  housekeeping_endpoint: string
  housekeeping_interval_seconds: number
  tick_interval_ms: number
  tick_lease_seconds: number
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
  /**
   * Which runtime owns task progression. `'server'` means a PHP daemon
   * runs the orchestrator — the SPA stays passive. `'client'` means
   * the SPA boots a SharedWorker (or dedicated Worker fallback) that
   * drives `/api/v1/tasks/{id}/tick` from this browser. Defaults to
   * `'server'` when the field is absent (legacy config responses).
   */
  worker_runtime_mode?: 'server' | 'client'
  /**
   * Browser-side tuning knobs for the client worker. Only present
   * when `worker_runtime_mode === 'client'`.
   */
  client_worker?: ClientWorkerConfig
}
