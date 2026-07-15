/**
 * Resource shape for GET /api/v1/apps. Mirrors AppsController on the
 * backend — keep both in sync when adding fields.
 *
 * `frontendEntry`, when present, points at a pre-built IIFE bundle the SPA
 * loads from `/plugins/<slug>/<frontendEntry>` (the path matches the
 * runtime URL the SPA actually fetches — no prefix insertion).
 *
 * `slug` is optional: "core-owned" apps (e.g. memories, plugins) don't map
 * to a plugin so the SPA routes them via the legacy hard-coded children.
 */
export interface AppResource {
  /** Stable identifier — used as the route segment under `/apps/<name>`. */
  name: string
  /** Operator-facing label rendered in the navbar dropdown. */
  displayName: string
  /** Single-line description shown in the dropdown tile. */
  description: string
  /** Bundled icon key (`puzzle`, `image`, …) or a raw SVG path. */
  icon: string
  /** Plugin slug for runtime frontend bundles; absent for "core-owned" apps. */
  slug?: string | null
  /** Bundle filename (e.g. `main.js`) the SPA loads from `/plugins/<slug>/`. */
  frontendEntry?: string | null
}
