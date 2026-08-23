import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { BOOT_FONT_SPECS, preloadFonts, watchFontChanges } from './index'

interface FakeFontFaceSet {
  load: ReturnType<typeof vi.fn>
  ready: Promise<unknown>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

const original = Object.getOwnPropertyDescriptor(document, 'fonts')

const install = (over: Partial<FakeFontFaceSet> = {}): FakeFontFaceSet => {
  const fake: FakeFontFaceSet = {
    load: vi.fn().mockResolvedValue([]),
    ready: Promise.resolve(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...over,
  }
  Object.defineProperty(document, 'fonts', {
    value: fake,
    configurable: true,
    writable: true,
  })
  return fake
}

afterEach(() => {
  if (original) Object.defineProperty(document, 'fonts', original)
  else Reflect.deleteProperty(document, 'fonts')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('BOOT_FONT_SPECS', () => {
  it('parses as font shorthands', () => {
    for (const spec of BOOT_FONT_SPECS) {
      expect(spec, spec).toMatch(/^\d{3} \d+px "[^"]+"$/)
    }
  })

  // A face declared in CSS but missing here is never awaited, so its first
  // canvas draw bakes the fallback glyphs into the label atlas.
  it('covers every @font-face declared in fonts.scss', () => {
    const scss = readFileSync(resolve('src/styles/fonts.scss'), 'utf-8')
    const specs = BOOT_FONT_SPECS.map((s) => {
      const m = /^(\d+) \d+px "(.+)"$/.exec(s)
      return { weight: Number(m![1]), family: m![2] }
    })

    for (const [, block] of scss.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
      const weight = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(block)
      const lo = Number(weight![1])
      // A variable face declares a range and downloads as one file, so a
      // single spec anywhere inside the range pulls the whole thing.
      const hi = weight![2] ? Number(weight![2]) : lo
      const covered = specs.some(
        (s) => s.family === family && s.weight >= lo && s.weight <= hi,
      )
      expect(covered, `${family} ${lo}${hi !== lo ? `-${hi}` : ''}`).toBe(true)
    }
  })
})

describe('preloadFonts', () => {
  it('requests every spec, then awaits ready', async () => {
    const fonts = install()
    await preloadFonts()
    expect(fonts.load).toHaveBeenCalledTimes(BOOT_FONT_SPECS.length)
    for (const spec of BOOT_FONT_SPECS) {
      expect(fonts.load).toHaveBeenCalledWith(spec)
    }
  })

  // A 404ing font must degrade to fallback glyphs, not leave the kiosk on a
  // black screen waiting for a mount that never happens.
  it('resolves even when a face fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    install({ load: vi.fn().mockRejectedValue(new Error('404')) })
    await expect(preloadFonts()).resolves.toBeUndefined()
  })

  it('resolves on the timeout when loading never settles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    install({ load: vi.fn().mockReturnValue(new Promise(() => {})) })
    vi.useFakeTimers()
    const done = preloadFonts(2500)
    await vi.advanceTimersByTimeAsync(2500)
    await expect(done).resolves.toBeUndefined()
  })

  it('is a no-op where the FontFaceSet API is absent', async () => {
    Reflect.deleteProperty(document, 'fonts')
    await expect(preloadFonts()).resolves.toBeUndefined()
  })
})

describe('watchFontChanges', () => {
  beforeEach(() => vi.useFakeTimers())

  it('debounces bursts of loadingdone into one call', () => {
    const fonts = install()
    const onChange = vi.fn()
    watchFontChanges(onChange, { debounceMs: 100, windowMs: 30_000 })

    const handler = fonts.addEventListener.mock.calls[0][1] as () => void
    handler()
    handler()
    handler()
    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  // Past the window, the only arrivals are unrelated `document.fonts.add`
  // calls, which must not be able to flush the engine's caches mid-game.
  it('stops listening after the window closes', () => {
    const fonts = install()
    watchFontChanges(vi.fn(), { windowMs: 30_000 })
    expect(fonts.removeEventListener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(fonts.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on demand and cancels a pending debounce', () => {
    const fonts = install()
    const onChange = vi.fn()
    const off = watchFontChanges(onChange, { debounceMs: 100 })
    const handler = fonts.addEventListener.mock.calls[0][1] as () => void
    handler()
    off()
    vi.advanceTimersByTime(1000)
    expect(onChange).not.toHaveBeenCalled()
    expect(fonts.removeEventListener).toHaveBeenCalled()
  })

  it('is a no-op where the FontFaceSet API is absent', () => {
    Reflect.deleteProperty(document, 'fonts')
    expect(() => watchFontChanges(vi.fn())()).not.toThrow()
  })
})

describe('shipped font payload', () => {
  // Every face is eager at boot, so the total is paid on every kiosk start.
  // A ratchet, not a limit: raise it deliberately when a face is worth it.
  const BUDGET_BYTES = 820_000

  it('stays within the boot budget', () => {
    const dir = resolve('src/assets/fonts')
    const total = readdirSync(dir)
      .filter((f) => /\.(woff2|otf|ttf)$/.test(f))
      .reduce((sum, f) => sum + statSync(resolve(dir, f)).size, 0)
    expect(total, `${Math.round(total / 1024)} KB of font files`).toBeLessThan(
      BUDGET_BYTES,
    )
  })

  // OFL requires the licence to travel with the font. `public/` is copied
  // verbatim into `dist/`, which the server binary embeds.
  it('ships a licence for every third-party family', () => {
    const licenses = readdirSync(resolve('public/fonts/licenses'))
    for (const family of [
      'AzeretMono',
      'Geist',
      'HKGrotesk',
      'Bungee',
      'Raleway',
      'Sniglet',
      'SortsMillGoudy',
      'Bagnard',
    ]) {
      expect(
        licenses.some((f) => f.startsWith(family)),
        `no licence file for ${family}`,
      ).toBe(true)
    }
  })
})
