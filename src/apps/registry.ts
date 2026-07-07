/**
 * Plugin frontend loader — dynamically imports plugin-supplied IIFE bundles
 * from `/plugins/<slug>/<entry>` and mounts them into a host-controlled
 * element. Plugins export their mount/unmount contract on the
 * `window.SporaApp<Name>` global (derived from their `build.lib.name`).
 *
 * Resolution model:
 *   1. The host SPA resolves the app via `GET /api/v1/apps`, where each
 *      entry has a `name`, optional `frontendEntry` (the bundle file under
 *      `/plugins/<slug>/`), and an optional `slug`.
 *   2. For an IIFE bundle built with `build.lib.name = 'SporaAppMediaArchive'`,
 *      the bundle assigns its export to `window.SporaAppMediaArchive`. We
 *      look that up here. (Vite's default IIFE wrapper turns `export const
 *      SporaApp = {...}` into `var SporaAppMediaArchive = {...}` followed
 *      by `window.SporaAppMediaArchive = SporaAppMediaArchive`.)
 *   3. We do NOT use Vite's module bundling for these URLs — the
 *      `@vite-ignore` comment on the dynamic `import()` keeps the URL
 *      untouched so the runtime fetches whatever the installer dropped at
 *      `public/plugins/<slug>/<entry>`.
 *   4. 404s mean the plugin was uninstalled (the bundle is gone but the
 *      route is still bookmarked) — surfaced as `error: 'uninstalled'`
 *      so the page can offer an install link.
 *   5. Unknown global → bundle loaded but didn't expose the expected
 *      shape. Surfaces as a generic `error: 'invalid'` so we don't render
 *      the page half-built.
 */
import { api } from '@/api/client'
import type { Pinia } from 'pinia'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import { useThemeStore } from '@/stores/theme'

/**
 * Subset of the host context we pass into the plugin's `mount()`. Adding a
 * field here means every plugin must rebuild before it can rely on it —
 * keep this surface deliberately small.
 */
export interface PluginHostContext {
  /** The host SPA's typed API client — plugins call `host.api.get('/media...')`. */
  api: typeof api
  /** The host's Pinia instance, so plugins can read auth/theme without a second copy. */
  pinia: Pinia
  /** Currently active theme string (`'dark'` | `'light'`). Plugins can also call `useThemeStore` via the pinia. */
  theme: string
  /** The host's current route — plugins already get their own router child path under `/apps/<slug>`. */
  route: RouteLocationNormalizedLoaded
  /** The host's Vue Router instance. Plugins that need it can `app.use(router)` themselves. */
  router: Router
}

export interface MountedPlugin {
  /** Tear the plugin down — clears the host element, calls the plugin's `unmount()` when defined. */
  unmount: () => void
}

export type MountPluginResult =
  | { ok: true; instance: MountedPlugin }
  | { ok: false; error: 'invalid' | 'uninstalled' | 'load_failed'; message: string }

/**
 * Derive the global binding name Vite's IIFE wrapper installs on `window`.
 *
 * Vite's `build.lib.name = 'SporaAppMediaArchive'` produces a `var SporaAppMediaArchive = {...}`
 * assignment and assigns it back to `window.SporaAppMediaArchive`. (The exact
 * shape of the wrapper is determined by Vite's rollup `output.banner`/`footer` —
 * verified empirically, see `docs/14_code_documentation` cross-refs.)
 *
 * We accept an optional explicit override for plugins that pick a different
 * global name (e.g. legacy bundles written before the `SporaApp<Name>` convention).
 */
export function globalFor(slug: string, override?: string): string {
  if (override) return override
  const pascal = slug
    .split('-')
    .filter(p => p.length > 0)
    .map(p => p[0].toUpperCase() + p.slice(1))
    .join('')
  return `SporaApp${pascal}`
}

interface PluginGlobal {
  mount: (target: HTMLElement, ctx: PluginHostContext) => void
  unmount?: (target: HTMLElement) => void
}

/**
 * Build the `PluginHostContext` that the host passes to the plugin's
 * `mount()`. Exposed so the Vue layer can pass equivalent values without
 * reaching into Pinia internals.
 */
export function buildHostContext(
  pinia: Pinia,
  router: Router,
  route: RouteLocationNormalizedLoaded,
): PluginHostContext {
  return {
    api,
    pinia,
    // Bind the theme read to the caller's Pinia instance — otherwise
    // `useThemeStore()` reads whichever store happens to be active and
    // can throw or return the wrong theme when the caller hasn't activated
    // `pinia` yet.
    theme: useThemeStore(pinia).isDark ? 'dark' : 'light',
    route,
    router,
  }
}

/**
 * Dynamically import `/plugins/<slug>/<entry>` and call the plugin's
 * `mount(target, hostContext)`. Returns a discriminated union so callers
 * (e.g. `usePluginApp`) can render the right fallback without inspecting
 * thrown exceptions.
 *
 * Vite note: the `@vite-ignore` comment prevents Vite from bundling the
 * URL — in production, this resolves to a runtime `fetch()` against
 * `public/plugins/<slug>/<entry>`. In dev mode, the SPA's
 * `vite.config.ts → server.proxy` block can route individual slugs to a
 * plugin's `npm run dev` HMR server.
 */
export async function mountPlugin(
  target: HTMLElement,
  slug: string,
  frontendEntry: string,
  hostContext: PluginHostContext,
): Promise<MountPluginResult> {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    return { ok: false, error: 'invalid', message: `Invalid plugin slug: ${slug}` }
  }
  // `frontendEntry` is a single bundle filename like `main.js` — reject
  // anything that could resolve to a nested path or escape the plugin dir.
  if (
    !frontendEntry
    || frontendEntry.startsWith('/')
    || frontendEntry.includes('/')
    || frontendEntry.includes('..')
  ) {
    return { ok: false, error: 'invalid', message: `Invalid frontend entry: ${frontendEntry}` }
  }

  try {
    // The `@vite-ignore` comment keeps this URL out of the production
    // bundle; it resolves at runtime to `/plugins/<slug>/<entry>` either
    // served from `public/plugins/<slug>/` (production) or via the dev
    // proxy in `vite.config.ts` (dev). The result is intentionally
    // discarded — we read the plugin contract from `window.SporaApp<Name>`
    // (set by the IIFE lib wrapper) rather than the module's default export.
    await import(/* @vite-ignore */ `/plugins/${slug}/${frontendEntry}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Most common case: 404 because the installer never ran (plugin
    // uninstalled). Vite/Rollup wraps fetch failures so we match on the
    // shape rather than a particular error class.
    if (/Failed to fetch dynamically|Loading.*chunk|404|not found/i.test(msg)) {
      return {
        ok: false,
        error: 'uninstalled',
        message: `Plugin "${slug}" is not installed.`,
      }
    }
    return { ok: false, error: 'load_failed', message: msg }
  }

  // Plugins export on `window.SporaApp<Name>` (the IIFE lib output we read via
  // `readGlobal` below); the default export is also exposed for plugin code
  // that prefers it but we don't currently read it.
  const candidate = readGlobal(globalFor(slug))
  const mount = (candidate as PluginGlobal | undefined)?.mount

  if (typeof mount !== 'function') {
    return {
      ok: false,
      error: 'invalid',
      message: `Plugin "${slug}" did not expose window.${globalFor(slug)}.mount() — bundle must export { mount, unmount } via IIFE build.`,
    }
  }

  // Plugin's mount may be sync or async; tolerate both.
  try {
    const maybeAsync: unknown = mount(target, hostContext)
    if (maybeAsync && typeof (maybeAsync as { then?: unknown }).then === 'function') {
      await (maybeAsync as Promise<void>)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: 'load_failed', message: msg }
  }

  const unmountCandidate = (candidate as PluginGlobal).unmount
  return {
    ok: true,
    instance: {
      unmount: () => {
        if (typeof unmountCandidate === 'function') {
          try {
            unmountCandidate(target)
            return
          } catch {
            // Fall through to the host-side teardown so we always leave
            // the slot empty for the next mount.
          }
        }
        target.innerHTML = ''
      },
    },
  }
}

interface GlobalWindow {
  [key: string]: unknown
}

function readGlobal(name: string): unknown {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as GlobalWindow
  return w[name]
}
