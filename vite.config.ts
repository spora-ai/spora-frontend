import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

/**
 * Build plugin dev-server proxies from `SPORA_PLUGIN_DEV_PORTS`.
 *
 * Operators running one or more plugin dev servers in parallel can
 * expose them through the host SPA without the host knowing their
 * slugs. Set the env var to a comma-separated `<slug>:<port>` list:
 *
 *   SPORA_PLUGIN_DEV_PORTS=media-archive:5174,calendar:5175 npm run dev
 *
 * Each entry becomes a proxy that forwards `/plugins/<slug>/*` to
 * the plugin's Vite dev server, so HMR pulls fresh sources on save.
 * Production ships the pre-built IIFE bundle at the same path via
 * `SporaPluginFrontendInstaller`; this is a dev-only convenience and
 * the host stays plugin-agnostic.
 */
function pluginDevProxies(): Record<string, { target: string; changeOrigin: boolean; ws: boolean }> {
  const entries = (process.env.SPORA_PLUGIN_DEV_PORTS ?? '').split(',')
  return entries.reduce<Record<string, { target: string; changeOrigin: boolean; ws: boolean }>>(
    (acc, raw) => {
      const entry = raw.trim()
      if (!entry.includes(':')) return acc
      const [slug, port] = entry.split(':')
      if (!slug || !/^\d+$/.test(port ?? '')) return acc
      acc[`/plugins/${slug}`] = {
        target: `http://localhost:${port}`,
        changeOrigin: true,
        ws: true,
      }
      return acc
    },
    {},
  )
}

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PHP_PORT || 8080}`,
        changeOrigin: true,
      },
      ...pluginDevProxies(),
    },
  },

  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.spec.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      reportsDirectory: './coverage',
      // Explicit include glob so V8 measures every source file the tests
      // could exercise, not only files transitively imported. Without this,
      // source files that have no direct import from a test (e.g.
      // `src/utils/cron.ts`) show as 0% covered even when their dedicated
      // spec passes.
      include: ['src/**/*.{ts,vue}'],
    },
  },
})
