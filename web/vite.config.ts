import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

/**
 * Prepend the shared SASS utilities to every SASS block so components can use
 * the `tint.*` namespace (spacing tokens, `type-class` mixin, focus helpers)
 * without an explicit `@use`. The leading whitespace of the original block is
 * preserved so indented SASS syntax stays valid.
 *
 * @param {string} source - The original SASS source passed to the compiler.
 * @returns {string} The source with the `@use` prepended.
 */
const prependStyleUtils = (source: string): string => {
  const prepend = `@use "@src/styles/utils.sass" as tint\n`
  const match = source.match(/^\s*/)
  const spaces = match ? match[0] : ''
  return `${spaces}${prepend}\n${source}`
}

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Proxy the printer-daemon so the web app uses same-origin relative URLs
    // in dev (no CORS). SSE (`/api/printer/events`) streams fine over this.
    // `/api/games` shares the same daemon, so it needs its own entry —
    // otherwise Vite serves the SPA fallback and every game-log POST/DELETE
    // hits a 404.
    proxy: {
      '/api/printer': {
        target: 'http://localhost:9110',
        changeOrigin: true,
      },
      '/api/games': {
        target: 'http://localhost:9110',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@src': src,
    },
  },
  css: {
    preprocessorOptions: {
      sass: {
        additionalData: prependStyleUtils,
      },
    },
  },
})
