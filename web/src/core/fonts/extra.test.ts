import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAMILIES } from '@src/core/theme/fonts'

// Vitest runs from `web/`, so paths are resolved from the project root.
const DISPLAYS = resolve('src/displays')

const kebab = (k: string): string =>
  k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/** Every non-test source file under `dir`. */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (e) =>
        e.isFile() &&
        /\.(ts|svelte|sass|scss)$/.test(e.name) &&
        !e.name.includes('.test.'),
    )
    .map((e) => join(e.parentPath, e.name))

/**
 * The ways a source names each family in `fonts-extra.scss`: the family name in
 * quotes, its `FAMILIES` handle, and its `--font-*` and `$font-*` variables.
 */
const extraFamilies = (): [string, RegExp][] => {
  const sheet = readFileSync(resolve('src/styles/fonts-extra.scss'), 'utf-8')
  const families = new Set(
    [...sheet.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]),
  )
  return [...families].map((family) => {
    const id = Object.keys(FAMILIES).find((k) =>
      FAMILIES[k as keyof typeof FAMILIES].startsWith(`"${family}"`),
    )
    const names = [`["']${family}["']`]
    if (id) {
      names.push(`FAMILIES\\.${id}\\b`, `[-$]-?font-${kebab(id)}\\b`)
    }
    return [family, new RegExp(names.join('|'))]
  })
}

// A display that draws with an extra face but never imports its sheet works in
// the full build, where another display may have loaded it, and silently falls
// back to a system font when built on its own.
describe('extra fonts', () => {
  const displays = readdirSync(DISPLAYS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it.each(displays)('%s loads the extra sheet if it uses its faces', (id) => {
    const dir = join(DISPLAYS, id)
    const files = sources(dir)
    const loads = files.some((f) =>
      readFileSync(f, 'utf-8').includes('@src/core/fonts/extra'),
    )
    if (loads) return
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      for (const [family, pattern] of extraFamilies()) {
        expect(
          pattern.test(text),
          `${file.slice(DISPLAYS.length + 1)} uses ${family}, which is in fonts-extra.scss, but ${id} never imports @src/core/fonts/extra`,
        ).toBe(false)
      }
    }
  })
})
