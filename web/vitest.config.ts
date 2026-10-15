import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  // Compiles `.svelte` and `.svelte.ts` files, so a module that uses runes loads
  // in a test the way it does in the app.
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      '@src': src,
    },
    // Svelte's browser build, which is the one with the client runtime.
    conditions: ['browser'],
  },
  test: {
    // happy-dom provides DOMMatrix, DOMParser, etc. Path2D is stubbed in the
    // setup file below (happy-dom doesn't ship it).
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
