import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

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
      // Per-plugin dev proxies. The line below forwards `/plugins/media-archive/*`
      // to the plugin's own Vite dev server (run `npm run dev` in
      // `spora-plugin-media-archive-frontend`, default port 5174) so HMR
      // pulls fresh sources on save. The production build ships the
      // pre-built IIFE bundle at the same path via
      // `SporaPluginFrontendInstaller`; this proxy is a dev-only convenience.
      //
      // To add another plugin's dev server, duplicate the line and point it
      // at the plugin's port.
      '/plugins/media-archive': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        ws: true,
      },
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
