import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { pluginDevProxies } from './vite/plugin-dev-proxies.ts'

export default defineConfig({
  plugins: [vue(), tailwindcss()],

  define: {
    // `__VUE_I18N_FULL_INSTALL__: false` drops the components and directives
    // the SPA never registers, which matters because they are pulled in by
    // `app.use(i18n)` alone. Safe.
    __VUE_I18N_FULL_INSTALL__: false,

    // `__INTLIFY_DROP_MESSAGE_COMPILER__: true` is deliberately NOT set.
    //
    // It does not merely tree-shake the compiler. In `@intlify/core-base`'s
    // `compile()` it selects the branch that returns the message verbatim and
    // logs "the message compiler is not included in this build" — so
    // `t('Hello {name}', { name: 'Ada' })` renders `Hello {name}`, and
    // `t('{n} item | {n} items', { n: 2 })` renders its own source. No
    // exception is thrown; the raw template simply ships to the browser.
    //
    // It only pays off when every message arrives precompiled, i.e. with
    // `@intlify/unplugin-vue-i18n`. Our catalogues are JSON pulled in by
    // `import.meta.glob`, so nothing is precompiled and the compiler is
    // load-bearing. Keeping the flag trades a few KB of bundle for silently
    // broken interpolation and plurals — the plan needs both (`Member removed
    // from {group}.`, and the `t('…|…', { count })` standardisation).
    //
    // `tests/i18n.spec.ts` asserts the working behaviour, so restoring the
    // flag fails the suite instead of reaching a German user.
  },

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
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
      // The floor the suite has to stay above. Without a threshold the
      // coverage report is a number nobody looks at, and coverage drifts
      // down one uncovered branch at a time.
      //
      // Measured on this tree: statements 91.33 %, branches 83.02 %,
      // functions 86.79 %, lines 93.05 %. The thresholds sit a little below
      // that so a single new source file does not break the build on the day
      // it lands — but a real drop still fails.
      thresholds: {
        statements: 91,
        branches: 82,
        functions: 86,
        lines: 92.5,
      },
    },
  },
})
