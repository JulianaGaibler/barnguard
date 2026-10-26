#!/usr/bin/env node
// Builds one display on its own, into `dist-<id>/`, for a static host:
//
//   npm run build:display contrast
//
// The build carries only that display and opens it at `/` with no URL
// parameter. See `vite/displays.ts` for what is left out, and
// `docs/installing-as-an-app.md` for deploying it.
//
// Only a display with a `public/manifest-<id>.webmanifest` builds by default.
// The others need the barnguard server for their game log, leaderboard or
// printer, and `--force` builds them anyway.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('..', import.meta.url))
const displaysDir = join(web, 'src', 'displays')
const all = readdirSync(displaysDir, { withFileTypes: true })
  .filter(
    (d) => d.isDirectory() && existsSync(join(displaysDir, d.name, 'index.ts')),
  )
  .map((d) => d.name)
  .sort()
const standalone = (id) =>
  existsSync(join(web, 'public', `manifest-${id}.webmanifest`))

const args = process.argv.slice(2)
const force = args.includes('--force')
const id = args.find((a) => !a.startsWith('--'))

if (!id) {
  console.log('Usage: npm run build:display <id> [-- --force]\n')
  for (const d of all) {
    console.log(`  ${d}${standalone(d) ? '' : '  (needs the server, --force)'}`)
  }
  process.exit(1)
}
if (!all.includes(id)) {
  console.error(`"${id}" is not a display. Known: ${all.join(', ')}`)
  process.exit(1)
}
if (!standalone(id) && !force) {
  console.error(
    `"${id}" has no public/manifest-${id}.webmanifest, so it is not meant to ` +
      'run without the server. Pass --force to build it anyway.',
  )
  process.exit(1)
}

const result = spawnSync(
  'npx',
  ['vite', 'build', '--base=./', '--outDir', `dist-${id}`, '--emptyOutDir'],
  {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, BARNGUARD_DISPLAY: id },
  },
)
process.exit(result.status ?? 1)
