import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@src': src,
    },
  },
  test: {
    // happy-dom provides DOMMatrix, DOMParser, etc. Path2D is stubbed in the
    // setup file below (happy-dom doesn't ship it).
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
