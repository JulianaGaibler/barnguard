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
    files: ['**/*.svelte'],
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
    ignores: ['dist/', 'node_modules/', '**/*.config.js', '**/*.config.ts'],
  },
)
