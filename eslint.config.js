import js from '@eslint/js'
import vuePlugin from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'

/**
 * The Vue plugin ships its rule sets without a `files` key, so once `.ts`
 * files are linted they would hit SFC rules (`vue/require-prop-types` on a
 * `defineProps` call in a `.ts` file). Scoping them to SFCs keeps the rule set
 * honest — a Vue rule has nothing to say about a `.ts` file.
 */
const vueSfcOnly = (config) => ({ ...config, files: config.files ?? ['**/*.vue'] })

export default tseslint.config(
  { ignores: ['dist/**', 'spora/**', 'node_modules/**', 'coverage/**', '.worktrees/**'] },
  js.configs.recommended,
  // `essential` adds the error-level rules that catch missing `:key=`
  // on `v-for`, single-word component names, unused components,
  // invalid template roots, and `v-for` on the wrong element. `recommended`
  // is loaded on top for the stylistic + a11y suggestions. Both
  // arrays must be spread wholesale — each flat config contributes its
  // own `plugins` / `languageOptions` block, and picking just `.rules`
  // drops the parser wiring so the rules never fire.
  ...vuePlugin.configs['flat/essential'].map(vueSfcOnly),
  ...vuePlugin.configs['flat/recommended'].map(vueSfcOnly),
  {
    files: ['**/*.vue'],
    plugins: {
      vue: vuePlugin,
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'off',
      'vue/attributes-order': 'off',
      'vue/no-v-html': 'off',
      // The `vue-eslint-parser` flags `</template v-else>` and similar
      // as `end-tag-with-attributes`, but Vue 3 SFCs accept attributes
      // on `</template>` closing tags (used for `v-if`/`v-else`/`v-else-if`
      // chains). The rule is a false positive for the Vue 3 grammar.
      'vue/no-parsing-error': ['error', { 'end-tag-with-attributes': false }],
      // Single-word component names like `Modal`, `Icon`, `Toast`,
      // `Toggle`, `Avatar`, `Skeleton` are an intentional naming
      // convention in this codebase — they're primitive UI primitives,
      // not domain concepts. Allow them; the underlying risk (clashing
      // with future native HTML elements) is real but accepted here.
      'vue/multi-word-component-names': 'off',
    },
  },
  // TypeScript sources and tests.
  //
  // ESLint only picks up `**/*.js` by default and this config had no `*.ts`
  // entry, so every `.ts` file in `src/` and `tests/` went through unlinted —
  // an `any`, an unused import, a mistyped call, all invisible to
  // `npm run lint`.
  //
  // The core `no-unused-vars` cannot read TypeScript-only constructs (type
  // parameters, overload signatures, `declare`), so `typescript-eslint`'s
  // rule set takes its place: its `eslint-recommended` block switches the
  // core rules off for `.ts` files, `no-undef` included — TypeScript resolves
  // identifiers itself, and the core rule misreads type-only names as
  // undefined variables.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: config.files ?? ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        // The codebase marks an intentionally unused parameter with a leading
        // underscore (`_value`, `_errorCode`, `setup(_, …)`).
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // A key pulled out of an object only to leave it out of a rest sibling
        // (`const { required_tools, ...legacy } = …`) is how the codebase
        // writes "drop this field" — the core rule ignores those,
        // `typescript-eslint` does not unless it is told to.
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'warn',
    },
  },
  {
    // Build-time Node scripts, not browser code. `typescript-eslint`'s
    // recommended block only covers `*.ts`, so without these globals
    // `no-undef` fires on every `console.log` and every `process` read.
    // The extractor's entire output is stdout — a report nobody reads is a
    // report nobody runs.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // The client worker runs outside the app bundle and cannot import the
    // app's logger module — `src/utils/logger.ts` says so explicitly. Its
    // debug output is gated behind the `?debug` flag, so the console calls
    // are deliberate.
    files: ['src/workers/**'],
    rules: {
      'no-console': 'off',
    },
  }
)