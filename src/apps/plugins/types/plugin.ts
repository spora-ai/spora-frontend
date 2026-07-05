/**
 * Resource shape for GET /api/v1/plugins. Mirrors PluginsService on the
 * backend — keep both in sync when adding fields.
 */

export type MigrationStatus = 'no_migrations' | 'up_to_date' | 'pending_migrations'

export interface BundledTool {
  /** snake_case tool name. The orchestrator prefixes the plugin slug at runtime. */
  name: string
  description: string
}

export interface BundledDriver {
  /** Provider key, e.g. "anthropic", "openai" */
  provider: string
  class: string
}

export interface MigrationInfo {
  /** Plugin-declared schema version (the integer hard-coded in PluginInterface::schemaVersion()) */
  declared: number
  /** Count of slug-prefixed migration files recorded in the `migrations` table */
  applied: number
  /** Count of slug-prefixed migration files present on disk */
  filesOnDisk: number
  /** filesOnDisk − applied, clamped to 0 */
  pending: number
  /** SQL-style Y-m-d H:i:s timestamp from `schema_versions.updated_at`, or null if never applied */
  lastAppliedAt: string | null
  status: MigrationStatus
}

export interface PluginResource {
  slug: string
  name: string
  description: string
  /** Bundled icon name (e.g. "puzzle") or a raw SVG path string starting with a path command letter (M/L/H/V/C/S/Q/T/A/Z). Resolved by the shared <Icon> component. Full <svg>…</svg> blobs are not accepted — ship icons as a single `d` string instead. Defaults to "puzzle" when the manifest omits it. */
  icon: string
  version: number
  /** Absolute filesystem path to the plugin directory, or null when loaded from a sidecar without a recorded directory. */
  path: string | null
  bundledTools: BundledTool[]
  bundledDrivers: BundledDriver[]
  recipePaths: string[]
  migrations: MigrationInfo
}

/**
 * Request body for POST /api/v1/plugins. `constraint` and `path` are mutually
 * exclusive — the backend rejects both being set.
 */
export interface PluginInstallRequest {
  package: string
  constraint?: string
  path?: string
}

/**
 * Response payload for POST/DELETE/PATCH /api/v1/plugins[/{package}]. Mirrors
 * the backend's PluginInstallResult value object.
 */
export interface PluginOperationResult {
  package: string
  status: 'installed' | 'uninstalled' | 'updated'
  constraint?: string | null
  path?: string | null
  message?: string
}

/**
 * Request body for PATCH /api/v1/plugins/{package}. The constraint is optional —
 * when omitted the backend re-uses the version currently pinned in composer.json.
 */
export interface PluginUpdateRequest {
  constraint?: string
}

/**
 * Packagist-shaped entry for GET /api/v1/plugins/catalog. The backend
 * re-filters Packagist's results to packages with `type === 'spora-plugin'`,
 * so consumers can trust every entry here is actually a Spora plugin.
 */
export interface CatalogEntry {
  /** Composer vendor/name. e.g. "spora-ai/spora-plugin-tavily". */
  name: string
  description: string
  version: string | null
  /** Packagist-reported total downloads (all-time, all versions). */
  downloads: number
  /** Packagist-reported stargazer count. */
  favorites: number
  /** VCS URL of the upstream repository, e.g. "https://github.com/spora-ai/spora-plugin-tavily". */
  repository: string | null
  homepage: string | null
}

/**
 * Response payload for GET /api/v1/plugins/catalog. The cache metadata
 * (`cached_at` + `ttl_seconds`) is shown in the UI so operators know
 * whether they're looking at a fresh result or a cached one.
 */
export interface CatalogResponse {
  packages: CatalogEntry[]
  /** Unix timestamp when the cache file was written. 0 means no cache. */
  cached_at: number
  /** TTL in seconds; combined with `cached_at` to determine freshness. */
  ttl_seconds: number
}