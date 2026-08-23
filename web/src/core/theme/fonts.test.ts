import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyFonts } from './index'
import {
  DEFAULT_FONTS,
  FAMILIES,
  FONT_CATALOGUE,
  FONT_ROLES,
  fontFor,
  fontWith,
  primaryFamily,
  resolveFonts,
  _resetFontWarningsForTests,
} from './fonts'
import type { ThemeFonts } from './types'

// Vitest runs from `web/`, and `import.meta.url` is not a file: URL under the
// Vite transform, so paths are resolved from the project root.
const read = (rel: string): string => readFileSync(resolve('src', rel), 'utf-8')

const GAMES_DIR = resolve('src/displays/arcade/games')

const kebab = (k: string): string =>
  k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/**
 * Every game's font tokens, discovered from disk rather than from the game
 * registry: importing the registry would pull in Svelte components, and this
 * test project has no Svelte plugin. Scanning also means a new game is covered
 * the moment it adds a `fonts.ts`, with nothing to remember to update here.
 */
const gameFontTokens = async (): Promise<[string, ThemeFonts][]> => {
  const out: [string, ThemeFonts][] = []
  for (const entry of readdirSync(GAMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!existsSync(`${GAMES_DIR}/${entry.name}/fonts.ts`)) continue
    const mod: Record<string, unknown> = await import(
      `@src/displays/arcade/games/${entry.name}/fonts.ts`
    )
    for (const [name, value] of Object.entries(mod)) {
      if (name.endsWith('FONT_TOKENS'))
        out.push([entry.name, value as ThemeFonts])
    }
  }
  return out
}

/** Families a browser resolves without an `@font-face`. */
const SYSTEM_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Arial Black',
  'Roboto',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Georgia',
  'Times New Roman',
  'Comic Sans MS',
])

describe('DEFAULT_FONTS', () => {
  it('covers every role', () => {
    expect(Object.keys(DEFAULT_FONTS).sort()).toEqual([...FONT_ROLES].sort())
  })

  it('ends every stack in a generic family, so nothing can resolve to nothing', () => {
    const generics = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']
    for (const role of FONT_ROLES) {
      const last = DEFAULT_FONTS[role].split(',').at(-1)?.trim()
      expect(generics, `role "${role}"`).toContain(last)
    }
  })

  // The defaults are duplicated into CSS because scale.sass owns the
  // never-undefined invariant for every token. This is what stops the copy
  // rotting.
  it('matches the --font-* block in scale.sass byte for byte', () => {
    const sass = read('styles/scale.sass')
    const found = new Map<string, string>()
    for (const [, name, value] of sass.matchAll(/--font-([a-z-]+):\s*(.+)/g)) {
      found.set(name, value.trim())
    }
    for (const role of FONT_ROLES) {
      expect(
        found.has(kebab(role)),
        `scale.sass is missing --font-${role}`,
      ).toBe(true)
      expect(found.get(kebab(role)), `role "${role}"`).toBe(DEFAULT_FONTS[role])
    }
  })
})

describe('declared families', () => {
  const declared = new Set(
    [...read('styles/fonts.scss').matchAll(/font-family:\s*'([^']+)'/g)].map(
      (m) => m[1],
    ),
  )

  const assertResolvable = (stack: string, where: string): void => {
    for (const raw of stack.split(',')) {
      const family = raw.trim().replace(/^['"]|['"]$/g, '')
      expect(
        declared.has(family) || SYSTEM_FAMILIES.has(family),
        `${where}: "${family}" is neither declared in fonts.scss nor a system family`,
      ).toBe(true)
    }
  }

  // A family name that matches no @font-face and no system font resolves
  // silently to the next entry in the stack, so this class of bug is invisible
  // until the day someone ships the real face under that name.
  it('every default stack names only real families', () => {
    for (const role of FONT_ROLES) {
      assertResolvable(DEFAULT_FONTS[role], `DEFAULT_FONTS.${role}`)
    }
  })

  it('every game font override names only real families', async () => {
    for (const [game, tokens] of await gameFontTokens()) {
      for (const role of FONT_ROLES) {
        const stack = tokens[role]
        if (stack) assertResolvable(stack, `${game}.${role}`)
      }
    }
  })

  it('every catalogue family is declared in fonts.scss', () => {
    for (const entry of FONT_CATALOGUE) {
      expect(declared, entry.family).toContain(entry.family)
    }
  })

  // The family handles are what most call sites reach for, so a typo in one of
  // their fallback tails would be as invisible as a typo in a role's.
  it('every family stack names only real families', () => {
    for (const [id, stack] of Object.entries(FAMILIES)) {
      assertResolvable(stack, `FAMILIES.${id}`)
    }
  })
})

describe('game font overrides', () => {
  it('use only known roles', async () => {
    for (const [game, tokens] of await gameFontTokens()) {
      for (const key of Object.keys(tokens)) {
        expect(FONT_ROLES, `${game} font tokens`).toContain(key)
      }
    }
  })
})

describe('FAMILIES', () => {
  it('has an entry for every catalogue family, and vice versa', () => {
    expect(Object.keys(FAMILIES).sort()).toEqual(
      FONT_CATALOGUE.map((e) => e.id).sort(),
    )
    for (const entry of FONT_CATALOGUE) {
      expect(primaryFamily(FAMILIES[entry.id]), entry.id).toBe(entry.family)
    }
  })

  // The family handles are duplicated into CSS so a stylesheet can name one
  // face without repeating its fallback tail. Same rot risk as the roles.
  it('matches the family --font-* block in scale.sass byte for byte', () => {
    const sass = read('styles/scale.sass')
    const found = new Map<string, string>()
    for (const [, name, value] of sass.matchAll(/--font-([a-z-]+):\s*(.+)/g)) {
      found.set(name, value.trim())
    }
    for (const [id, stack] of Object.entries(FAMILIES)) {
      const cssName = kebab(id)
      expect(
        found.has(cssName),
        `scale.sass is missing --font-${cssName}`,
      ).toBe(true)
      expect(found.get(cssName), id).toBe(stack)
    }
  })

  it('declares nothing beyond the roles and the families', () => {
    const sass = read('styles/scale.sass')
    const declared = [...sass.matchAll(/--font-([a-z-]+):/g)].map((m) => m[1])
    const expected = [
      ...FONT_ROLES.map(kebab),
      ...Object.keys(FAMILIES).map(kebab),
    ]
    expect(declared.sort()).toEqual(expected.sort())
  })
})

describe('resolveFonts', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveFonts()).toEqual(DEFAULT_FONTS)
    expect(resolveFonts(undefined)).toEqual(DEFAULT_FONTS)
  })

  it('lets later layers win and leaves unset roles alone', () => {
    const out = resolveFonts(
      { text: 'A, sans-serif' },
      { text: 'B, sans-serif' },
    )
    expect(out.text).toBe('B, sans-serif')
    expect(out.heading).toBe(DEFAULT_FONTS.heading)
  })

  it('does not mutate DEFAULT_FONTS', () => {
    resolveFonts({ text: 'A, sans-serif' })
    expect(DEFAULT_FONTS.text).toContain('Mozilla Text')
  })
})

describe('fontFor', () => {
  beforeEach(_resetFontWarningsForTests)

  it('composes a valid CSS font shorthand', () => {
    const f = resolveFonts()
    expect(fontFor(f, 'text', 700, 24)).toBe(`700 24px ${DEFAULT_FONTS.text}`)
  })

  it('quantises the size so the label cache key stays stable', () => {
    const f = resolveFonts()
    // A screen-space size divided by a camera scale drifts in the last digits
    // every frame; without quantisation every draw would miss the cache.
    expect(fontFor(f, 'text', 400, 16.0000031)).toBe(
      fontFor(f, 'text', 400, 16.0000009),
    )
  })

  it('snaps a weight the family does not ship', () => {
    const f = resolveFonts()
    // Mozilla Text ships 400/500/700. Asking for 800 would otherwise get a
    // browser-synthesised bold, which differs across engines.
    expect(fontFor(f, 'text', 800, 20)).toBe(`700 20px ${DEFAULT_FONTS.text}`)
    expect(fontFor(f, 'text', 600, 20)).toBe(`500 20px ${DEFAULT_FONTS.text}`)
  })

  it('leaves weights alone for stacks outside the catalogue', () => {
    expect(fontWith('system-ui, sans-serif', 850, 12)).toBe(
      '850 12px system-ui, sans-serif',
    )
  })

  it('clamps rather than snaps for a variable family', () => {
    // Azeret Mono covers 100-900, so an in-range weight is used as asked.
    expect(fontWith(FAMILIES.azeretMono, 650, 14)).toBe(
      `650 14px ${FAMILIES.azeretMono}`,
    )
    expect(fontWith(FAMILIES.azeretMono, 1200, 14)).toBe(
      `900 14px ${FAMILIES.azeretMono}`,
    )
  })

  it('warns once per role and weight in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = resolveFonts()
    fontFor(f, 'text', 800, 20)
    fontFor(f, 'text', 800, 44)
    expect(warn).toHaveBeenCalledTimes(1)
    fontFor(f, 'text', 600, 20)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('applyFonts', () => {
  const fakeEl = (): {
    el: HTMLElement
    set: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  } => {
    const set = vi.fn()
    const remove = vi.fn()
    return {
      el: {
        style: { setProperty: set, removeProperty: remove },
      } as unknown as HTMLElement,
      set,
      remove,
    }
  }

  it('writes a role as its custom property', () => {
    const { el, set } = fakeEl()
    applyFonts(el, { heading: 'X, sans-serif' })
    expect(set).toHaveBeenCalledWith('--font-heading', 'X, sans-serif')
  })

  it('skips unset roles', () => {
    const { el, set } = fakeEl()
    applyFonts(el, { text: 'X, sans-serif', heading: undefined })
    expect(set).toHaveBeenCalledTimes(1)
  })

  // A scoped override that removed properties would tear a hole through to the
  // display theme for any role it left out.
  it('never removes a property', () => {
    const { el, remove } = fakeEl()
    applyFonts(el, { text: 'X, sans-serif', heading: undefined })
    expect(remove).not.toHaveBeenCalled()
  })
})
