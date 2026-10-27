import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { displays } from './vite/displays'

const src = fileURLToPath(new URL('./src', import.meta.url))
const publicDir = fileURLToPath(new URL('./public', import.meta.url))
// The `stargazer` engine loads data files from next to its code, which the dev
// server refuses to serve unless the folder is allowed.
const stargazerDir = dirname(
  createRequire(import.meta.url).resolve('stargazer/package.json'),
)

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
  plugins: [
    // Which displays this build carries: all of them, or the one named by
    // `BARNGUARD_DISPLAY` (see `npm run build:display`).
    displays(src, publicDir),
    svelte({
      // The engine's debug UI is Svelte components with their own styles. Served
      // from `node_modules`, the dev server cannot find their separate CSS and
      // answers with the component's whole source, which drops the first rule of
      // each. Having the components inject their own styles avoids the lookup.
      dynamicCompileOptions: ({ filename }) =>
        filename.includes('/node_modules/stargazer/')
          ? { css: 'injected' }
          : undefined,
    }),
    // The service worker keeps the installed app working offline. The pages
    // register it themselves, in `core/pwa/register.ts`, and the manifests are
    // plain files in `public/`.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: [
          // `bin` and `json` cover the engine's data files (the squircle field,
          // splash animations), which it fetches next to its code.
          '**/*.{js,css,html,png,svg,woff,woff2,ttf,otf,lottie,webmanifest,bin,json}',
        ],
        // The debug models are only for the engine demos.
        globIgnores: ['debug/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), stargazerDir] },
    // Lets other machines on the tailnet load the dev server by name, for
    // running benchmarks on other GPUs. Vite rejects unknown Host headers.
    allowedHosts: ['bubblegum.local.yaina.dev'],
    // Proxy the printer-daemon so the web app uses same-origin relative URLs
    // in dev (no CORS). SSE (`/api/printer/events`) streams fine over this.
    // `/api/games` and `/api/leaderboard` share the same daemon, so each
    // needs its own entry. Otherwise Vite serves the SPA fallback and every
    // POST/DELETE hits a 404.
    proxy: {
      '/api/printer': {
        target: 'http://localhost:9110',
        changeOrigin: true,
      },
      '/api/games': {
        target: 'http://localhost:9110',
        changeOrigin: true,
      },
      '/api/leaderboard': {
        target: 'http://localhost:9110',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@src': src,
    },
    // One Svelte runtime, shared with the `stargazer` package.
    dedupe: ['svelte'],
  },
  // The engine loads data files with `new URL('./x.bin', import.meta.url)`.
  // Pre-bundling moves its code to `.vite/deps`, where those files are not, and
  // the dev server answers the request with the page instead.
  optimizeDeps: {
    exclude: ['stargazer', 'stargazer/debug-ui'],
  },
  css: {
    preprocessorOptions: {
      sass: {
        additionalData: prependStyleUtils,
      },
    },
  },
})
