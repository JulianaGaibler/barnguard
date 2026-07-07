const config = {
  semi: false,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 80,
  tabWidth: 2,
  plugins: ['prettier-plugin-jsdoc', 'prettier-plugin-svelte'],
  overrides: [
    {
      files: '*.svelte',
      options: { parser: 'svelte' },
    },
  ],
}

export default config
