import { computed, type ComputedRef } from 'vue'

/**
 * useFeatureEnabled — minimal feature-flag composable.
 *
 * For v0.6.2 the only gated feature is `plugin_install`. The server's
 * `SPORA_PLUGIN_INSTALL_ENABLED` env var is the source of truth; this
 * composable mirrors that default at build time via `import.meta.env`.
 *
 * Build-time injection (Vite):
 *   VITE_FEATURE_PLUGIN_INSTALL=true|false
 *
 * When the var is unset we default to `true` for local dev convenience
 * (the operator turns it off by setting `SPORA_PLUGIN_INSTALL_ENABLED=false`
 * on the backend). A long-term follow-up will introduce a runtime
 * `GET /api/v1/features` endpoint so the client can react to server-side
 * flag changes without a redeploy — tracked separately.
 */
export type FeatureFlag = 'plugin_install'

const DEFAULTS: Record<FeatureFlag, boolean> = {
  plugin_install: true,
}

function readEnv(flag: FeatureFlag): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[
    `VITE_FEATURE_${flag.toUpperCase()}`
  ]
  if (raw === undefined) {
    return DEFAULTS[flag]
  }
  return raw === 'true' || raw === '1'
}

/**
 * Reactive boolean indicating whether the named feature is enabled.
 * The composable takes no arguments and returns a single ref so callers
 * can use it directly in templates.
 */
export function useFeatureEnabled(flag: FeatureFlag): ComputedRef<boolean> {
  return computed(() => readEnv(flag))
}