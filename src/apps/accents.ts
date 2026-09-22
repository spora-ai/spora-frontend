/**
 * Tile-accent tokens the host renders. Mirrors `AppInterface::ACCENT_TOKENS`
 * on the backend — keep both in sync when adding colours. The token → Tailwind
 * gradient mapping lives in `GlobalSheetApps.vue`. Unknown tokens are
 * defensively coerced to `APP_ACCENT_DEFAULT` so a plugin author's typo
 * never breaks the SPA.
 */
export const APP_ACCENT_TOKENS = [
  'violet',
  'amber',
  'emerald',
  'sky',
  'rose',
  'primary',
] as const

export type AppAccent = (typeof APP_ACCENT_TOKENS)[number]

export const APP_ACCENT_DEFAULT: AppAccent = 'primary'
