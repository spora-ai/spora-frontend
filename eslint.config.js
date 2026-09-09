import js from '@eslint/js'
import vuePlugin from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'spora/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  // `essential` adds the error-level rules that catch missing `:key=`
  // on `v-for`, single-word component names, unused components,
  // invalid template roots, and `v-for` on the wrong element. `recommended`
  // is loaded on top for the stylistic + a11y suggestions. Both
  // arrays must be spread wholesale — each flat config contributes its
  // own `plugins` / `languageOptions` block, and picking just `.rules`
  // drops the parser wiring so the rules never fire.
  ...vuePlugin.configs['flat/essential'],
  ...vuePlugin.configs['flat/recommended'],
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
  {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'warn',
    },
  }
)