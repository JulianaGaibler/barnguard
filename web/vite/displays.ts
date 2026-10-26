import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'

/** The environment variable that narrows a build to one display. */
const DISPLAY_ENV = 'BARNGUARD_DISPLAY'

const VIRTUAL_ID = 'virtual:displays'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * The ids of every display: each folder in `src/displays/` that has an
 * `index.ts`. The folder name is the id.
 *
 * @param srcDir - Absolute path of `web/src`.
 */
function listDisplays(srcDir: string): string[] {
  const root = join(srcDir, 'displays')
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(root, d.name, 'index.ts')),
    )
    .map((d) => d.name)
    .sort()
}

/**
 * Picks the displays a build carries and serves them as `virtual:displays`.
 *
 * Without `BARNGUARD_DISPLAY` the build carries every display and `main.ts`
 * picks one from `?display=`, as the booth kiosks do. With it, the build
 * carries only that display and boots it with no URL parameter:
 *
 * - `__SINGLE_DISPLAY__` is the id, or `null` in a full build. It is replaced at
 *   build time, so a branch on it is removed outright.
 * - `@src/dev/boot` is swapped for an empty stub. Rollup still transforms the
 *   modules behind an `import()` it removes, and Vite emits their assets while
 *   transforming, so dead code alone would still ship the dev surfaces' files.
 * - `public/` is not copied. Only the display's own manifest, its icons and the
 *   font licences are written.
 *
 * @param srcDir - Absolute path of `web/src`.
 * @param publicDir - Absolute path of `web/public`.
 */
export function displays(srcDir: string, publicDir: string): Plugin {
  const only = process.env[DISPLAY_ENV] || null
  const all = listDisplays(srcDir)
  if (only !== null && !all.includes(only)) {
    throw new Error(
      `${DISPLAY_ENV}="${only}" is not a display. Known: ${all.join(', ')}`,
    )
  }
  const ids = (): string[] => (only ? [only] : listDisplays(srcDir))

  return {
    name: 'barnguard-displays',

    config() {
      return {
        define: { __SINGLE_DISPLAY__: JSON.stringify(only) },
        ...(only && {
          publicDir: false as const,
          resolve: {
            alias: [
              {
                find: /^@src\/dev\/boot$/,
                replacement: join(srcDir, 'dev', 'boot.stub.ts'),
              },
            ],
          },
        }),
      }
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },

    load(id) {
      if (id !== RESOLVED_ID) return null
      const entries = ids().map((name) => {
        const file = join(srcDir, 'displays', name, 'index.ts')
        return `  ${JSON.stringify(name)}: () => import(${JSON.stringify(file)}).then((m) => m.default),`
      })
      return `export const displayRegistry = {\n${entries.join('\n')}\n}\n`
    },

    // A display folder added or removed while the dev server runs changes the
    // registry, which is generated, so nothing else would notice.
    configureServer(server) {
      const root = join(srcDir, 'displays')
      const onChange = (path: string): void => {
        const rel = relative(root, path)
        if (rel.startsWith('..') || !/^[^/\\]+[/\\]index\.ts$/.test(rel)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },

    transformIndexHtml(html) {
      if (!only) return html
      const name = readWebManifest(publicDir, only)?.name
      if (typeof name !== 'string') return html
      return html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    },

    generateBundle() {
      if (!only) return
      const emit = (fileName: string, source: string | Uint8Array): void => {
        this.emitFile({ type: 'asset', fileName, source })
      }

      const webManifest = readWebManifest(publicDir, only)
      if (webManifest) {
        // The id stays `./?display=<id>`, the same as the full build's, so a
        // single build served where a full one was counts as the same app.
        webManifest.id ??= `./?display=${only}`
        webManifest.start_url = './'
        emit(
          `manifest-${only}.webmanifest`,
          JSON.stringify(webManifest, null, 2) + '\n',
        )
      }

      const icons = join(publicDir, 'icons')
      if (existsSync(icons)) {
        for (const file of readdirSync(icons)) {
          if (file.startsWith(`${only}-`)) {
            emit(`icons/${file}`, readFileSync(join(icons, file)))
          }
        }
      }

      const licenses = join(publicDir, 'fonts', 'licenses')
      for (const file of readdirSync(licenses)) {
        emit(`fonts/licenses/${file}`, readFileSync(join(licenses, file)))
      }
    },
  }
}

/** The parsed `public/manifest-<id>.webmanifest`, or `null` if it has none. */
function readWebManifest(
  publicDir: string,
  id: string,
): Record<string, unknown> | null {
  const path = join(publicDir, `manifest-${id}.webmanifest`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}
