/**
 * Build the host SPA's plugin dev-server proxy map.
 *
 * Operators running one or more plugin dev servers in parallel can
 * expose them through the host without the host knowing their slugs.
 * Set `SPORA_PLUGIN_DEV_PORTS` to a comma-separated `<slug>:<port>`
 * list:
 *
 *   SPORA_PLUGIN_DEV_PORTS=media-archive:5174,calendar:5175 npm run dev
 *
 * Each entry becomes a proxy that forwards `/plugins/<slug>/*` to the
 * plugin's Vite dev server, so HMR pulls fresh sources on save.
 * Production ships the pre-built IIFE bundle at the same path via
 * `SporaPluginFrontendInstaller`; this is a dev-only convenience and
 * the host stays plugin-agnostic.
 *
 * Lives in its own module so it can be unit-tested without booting
 * Vite's plugin pipeline.
 */

export interface PluginProxyOptions {
  target: string
  changeOrigin: boolean
  ws: boolean
}

export type PluginProxyMap = Record<string, PluginProxyOptions>

const DEFAULT_PROXY: PluginProxyOptions = { target: '', changeOrigin: true, ws: true }

/**
 * Parse a single `slug:port` entry. Returns null when the entry is
 * malformed (missing slug, missing/invalid port).
 */
export function parsePluginEntry(raw: string): { slug: string; port: string } | null {
  const entry = raw.trim()
  if (!entry.includes(':')) return null
  const [slug, port] = entry.split(':')
  if (!slug || !/^\d+$/.test(port ?? '')) return null
  return { slug, port }
}

/**
 * Build the proxy map from a raw `SPORA_PLUGIN_DEV_PORTS` value.
 *
 * Behavior:
 *  - `undefined`, empty, or whitespace-only → empty map
 *  - malformed entries (missing `:`, non-numeric port, empty slug) are
 *    skipped silently — we don't want a typo in one plugin's spec to
 *    break the whole dev server boot
 *  - duplicate slugs: the last entry wins (idempotent for retried runs)
 */
export function pluginDevProxies(ports?: string): PluginProxyMap {
  const raw = ports ?? ''
  if (!raw.trim()) return {}
  const result: PluginProxyMap = {}
  for (const entry of raw.split(',')) {
    const parsed = parsePluginEntry(entry)
    if (!parsed) continue
    result[`/plugins/${parsed.slug}`] = { ...DEFAULT_PROXY, target: `http://localhost:${parsed.port}` }
  }
  return result
}