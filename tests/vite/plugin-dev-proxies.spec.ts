import { describe, expect, it } from 'vitest'
import { parsePluginEntry, pluginDevProxies, pluginPathRewrite } from '../../vite/plugin-dev-proxies'

describe('parsePluginEntry', () => {
  it('parses a valid slug:port entry', () => {
    expect(parsePluginEntry('media-archive:5174')).toEqual({ slug: 'media-archive', port: '5174' })
  })

  it('trims surrounding whitespace', () => {
    expect(parsePluginEntry('  calendar:5175  ')).toEqual({ slug: 'calendar', port: '5175' })
  })

  it('rejects entries without a colon', () => {
    expect(parsePluginEntry('media-archive')).toBeNull()
  })

  it('rejects entries with a missing slug', () => {
    expect(parsePluginEntry(':5174')).toBeNull()
  })

  it('rejects entries with a non-numeric port', () => {
    expect(parsePluginEntry('media-archive:abc')).toBeNull()
    expect(parsePluginEntry('media-archive:')).toBeNull()
    expect(parsePluginEntry('media-archive:5174a')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(parsePluginEntry('')).toBeNull()
    expect(parsePluginEntry('   ')).toBeNull()
  })
})

describe('pluginDevProxies', () => {
  it('returns an empty map when the env var is undefined', () => {
    expect(pluginDevProxies(undefined)).toEqual({})
  })

  it('returns an empty map when the env var is empty or whitespace', () => {
    expect(pluginDevProxies('')).toEqual({})
    expect(pluginDevProxies('   ')).toEqual({})
  })

  it('builds a proxy for a single entry', () => {
    const proxies = pluginDevProxies('media-archive:5174')
    expect(proxies).toEqual({
      '/plugins/media-archive': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        ws: true,
        rewrite: expect.any(Function),
      },
    })
    // The rewrite maps the runtime contract path to the plugin's Vite
    // source path. The /plugins/<slug>/ prefix is KEPT (not stripped)
    // so the plugin's `base: '/plugins/<slug>/'` config matches the
    // forwarded path.
    expect(proxies['/plugins/media-archive']?.rewrite?.('/plugins/media-archive/main.js')).toBe('/plugins/media-archive/src/main.ts')
  })

  it('builds proxies for multiple comma-separated entries', () => {
    const proxies = pluginDevProxies('media-archive:5174,calendar:5175')
    expect(Object.keys(proxies).sort()).toEqual(['/plugins/calendar', '/plugins/media-archive'])
    expect(proxies['/plugins/media-archive']?.target).toBe('http://localhost:5174')
    expect(proxies['/plugins/calendar']?.target).toBe('http://localhost:5175')
  })

  it('skips malformed entries without aborting the whole map', () => {
    const proxies = pluginDevProxies('media-archive:5174,bad-no-colon,calendar:abc,calendar:5175')
    expect(Object.keys(proxies).sort()).toEqual(['/plugins/calendar', '/plugins/media-archive'])
  })

  it('lets the last duplicate slug win', () => {
    const proxies = pluginDevProxies('media-archive:5174,media-archive:5180')
    expect(proxies['/plugins/media-archive']?.target).toBe('http://localhost:5180')
  })

  it('every proxy has changeOrigin and ws enabled', () => {
    const proxies = pluginDevProxies('a:5174,b:5175')
    for (const value of Object.values(proxies)) {
      expect(value.changeOrigin).toBe(true)
      expect(value.ws).toBe(true)
    }
  })

  it('installs a slug-scoped rewrite on every proxy', () => {
    const proxies = pluginDevProxies('a:5174,b:5175')
    expect(proxies['/plugins/a']?.rewrite?.('/plugins/a/main.js')).toBe('/plugins/a/src/main.ts')
    expect(proxies['/plugins/b']?.rewrite?.('/plugins/b/main.js')).toBe('/plugins/b/src/main.ts')
    // Slug isolation: a rewrite for slug `a` is no-op for paths under
    // a different slug — the contract path is plugin-prefix-specific.
    // The proxy key already routes by prefix, so this shouldn't happen
    // in practice; the rewrite is defensive.
    expect(proxies['/plugins/a']?.rewrite?.('/plugins/b/main.js')).toBe('/plugins/b/main.js')
  })
})

describe('pluginPathRewrite', () => {
  it('maps the runtime contract path to the source entry (keeps the prefix)', () => {
    // The plugin's Vite is configured with `base: '/plugins/<slug>/'`,
    // so it serves the lib entry at `/plugins/<slug>/src/main.ts`.
    // The rewrite only changes the filename; the prefix stays so the
    // plugin's base matches the forwarded URL.
    expect(pluginPathRewrite('media-archive')('/plugins/media-archive/main.js')).toBe('/plugins/media-archive/src/main.ts')
  })

  it('passes through any other path unchanged', () => {
    // Sub-requests for vue, pinia, source components, etc. all carry
    // the /plugins/<slug>/ prefix from the plugin's base config and
    // are served as-is by the plugin's Vite. No rewrite needed.
    expect(pluginPathRewrite('media-archive')('/plugins/media-archive/node_modules/.vite/deps/vue.js')).toBe('/plugins/media-archive/node_modules/.vite/deps/vue.js')
    expect(pluginPathRewrite('media-archive')('/plugins/media-archive/src/components/MediaGrid.vue')).toBe('/plugins/media-archive/src/components/MediaGrid.vue')
  })

  it('returns the original path when the contract suffix is wrong', () => {
    // The contract is `<slug>/main.js`. Other entry filenames fall
    // through unchanged (a future <slug>/style.css would be served
    // by the plugin's Vite as-is).
    expect(pluginPathRewrite('media-archive')('/plugins/media-archive/style.css')).toBe('/plugins/media-archive/style.css')
  })

  it('returns the original path when the prefix does not match', () => {
    // Defensive: the proxy prefix is fixed in the proxy key, so a
    // request with a different prefix should never reach this rewrite.
    // If it does (mis-configured proxy), we don't want to silently mangle.
    expect(pluginPathRewrite('media-archive')('/plugins/other/main.js')).toBe('/plugins/other/main.js')
  })

  it('preserves the query string on the rewritten path', () => {
    // Vite's http-proxy passes the full path (including query) to the
    // rewrite function, then forwards the rewritten value as-is. Query
    // strings (e.g. Vite's cache-busting `?v=`) must flow through.
    expect(pluginPathRewrite('media-archive')('/plugins/media-archive/main.js?v=hash')).toBe('/plugins/media-archive/src/main.ts?v=hash')
  })
})