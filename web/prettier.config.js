const config = {
  semi: false,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 80,
  tabWidth: 2,
  plugins: ['prettier-plugin-jsdoc', 'prettier-plugin-svelte'],
  // Doc examples are snippets, not standalone programs, so the jsdoc plugin
  // often cannot parse them. Without this it discards their indentation and a
  // nested block comes out flat.
  jsdocKeepUnParseAbleExampleIndent: true,
  overrides: [
    {
      files: '*.svelte',
      options: { parser: 'svelte' },
    },
  ],
}

export default config
