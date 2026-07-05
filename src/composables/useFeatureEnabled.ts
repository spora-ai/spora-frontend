import { computed, type ComputedRef } from 'vue'

/**
 * useFeatureEnabled — reads a build-time VITE_FEATURE_* var via import.meta.env
 * and defaults to true when unset. Build-time only: a redeploy is required to
 * flip the flag; a future runtime `/api/v1/features` endpoint will replace this.
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
 * Reads the build-time `VITE_FEATURE_*` env var; falls back to a sensible
 * default when unset (see DEFAULTS). Callers should treat the result as
 * cosmetic — the server is the source of truth.
 */
export function useFeatureEnabled(flag: FeatureFlag): ComputedRef<boolean> {
  return computed(() => readEnv(flag))
}