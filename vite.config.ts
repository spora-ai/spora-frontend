import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { pluginDevProxies } from './vite/plugin-dev-proxies'

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // base: '/spora/' rewrites every emitted asset URL (index.html <link>/<script>,
  // and any runtime URL from `?asset` imports) so the SPA can be served from
  // the operator's `/spora/*` URL space. outDir matches the installer's
  // route target (SporaFrontendInstaller → `public/spora/`) so the source
  // build output and the deploy path line up.
  base: '/spora/',
  build: {
    outDir: 'spora',
    emptyOutDir: true,
  },

  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PHP_PORT || 8080}`,
        changeOrigin: true,
      },
      ...pluginDevProxies(process.env.SPORA_PLUGIN_DEV_PORTS),
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
