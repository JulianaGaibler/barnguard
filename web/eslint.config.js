import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import svelteConfig from './svelte.config.js'
import globals from 'globals'

export default ts.config(
  // js
  js.configs.recommended,
  // ts
  ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // svelte
  ...svelte.configs['flat/recommended'],
  {
    // `.svelte.ts` modules hold runes, so they go through the same parser pair
    // as components: the svelte parser, with TypeScript underneath.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig: svelteConfig,
      },
    },
  },
  {
    rules: {
      'svelte/no-at-html-tags': 'off',
      // Stargazer is used through its entry points only. Anything else is
      // internal and can change without notice.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(@src/)?stargazer/(?!(debug-ui|testing)$)',
              message:
                "Import from 'stargazer', 'stargazer/debug-ui' or 'stargazer/testing'.",
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
        ...globals.browser,
      },
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
)
