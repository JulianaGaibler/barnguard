import { describe, expect, it } from 'vitest'
import { parseSvgPaths, deepestInteriorPoint } from '@src/stargazer'

/**
 * The Europe map carries identity on a wrapping `<g id>` for every country
 * drawn in more than one piece (Greece alone is 40 subpaths), so the parser's
 * group keying and contour merging is what holds a country together. The ids
 * are ISO 3166-1 alpha-3 apart from `gFI1` and `gFR1`, which the export tool
 * suffixed.
 *
 * Minifying this file needs id preservation (`svgo --disable=cleanupIds` or the
 * equivalent), since stripping ids leaves 54 anonymous paths and no country
 * identity at all.
 */
describe('Enterprise eu-countries.svg', () => {
  const EXPECTED = [
    'gALB',
    'gAND',
    'gAUT',
    'gBEL',
    'gBGR',
    'gBIH',
    'gBLR',
    'gCHE',
    'gCYN',
    'gCYP',
    'gCZE',
    'gDEU',
    'gDNK',
    'gESP',
    'gEST',
    'gFI1',
    'gFR1',
    'gFRO',
    'gGBR',
    'gGGY',
    'gGIB',
    'gGRC',
    'gHRV',
    'gHUN',
    'gIMN',
    'gIRL',
    'gISL',
    'gITA',
    'gJEY',
    'gLIE',
    'gLTU',
    'gLUX',
    'gLVA',
    'gMCO',
    'gMDA',
    'gMKD',
    'gMLT',
    'gMNE',
    'gNLD',
    'gNOR',
    'gPOL',
    'gPRT',
    'gRKS',
    'gROU',
    'gSMR',
    'gSRB',
    'gSVK',
    'gSVN',
    'gSWE',
    'gUKR',
    'gVAT',
  ]

  it('parses into exactly the 51 drawn countries with non-empty bounds', async () => {
    const raw = (await import('./eu-countries.svg?raw')).default
    const map = parseSvgPaths(raw)
    expect(map.viewBox.width).toBe(1134)
    expect(map.viewBox.height).toBe(1167)
    expect([...map.paths.keys()].sort()).toEqual([...EXPECTED].sort())
    for (const id of EXPECTED) {
      const entry = map.paths.get(id)
      expect(entry, `${id} missing`).toBeDefined()
      expect(entry!.bounds.width, `${id} has no width`).toBeGreaterThan(0)
      expect(entry!.bounds.height, `${id} has no height`).toBeGreaterThan(0)
    }
  })

  it('tessellates every country within the 16-bit index limit', async () => {
    const raw = (await import('./eu-countries.svg?raw')).default
    const map = parseSvgPaths(raw, { tessellate: true })
    for (const id of EXPECTED) {
      const entry = map.paths.get(id)!
      expect(entry.triangles, `${id} has no triangles`).toBeDefined()
      expect(
        entry.triangles!.indices.length,
        `${id} has no indices`,
      ).toBeGreaterThan(0)
      expect(entry.triangles!.indices.length % 3).toBe(0)
    }
  })

  it('derives an epicenter that lands inside every country', async () => {
    const raw = (await import('./eu-countries.svg?raw')).default
    const map = parseSvgPaths(raw, { tessellate: true })
    for (const id of EXPECTED) {
      const entry = map.paths.get(id)!
      const pt = deepestInteriorPoint(entry.contours!)
      expect(pt, `${id} has no interior point`).not.toBeNull()
      // Even-odd containment across the country's own contours, the same rule
      // the fill uses, so the epicenter sits on painted pixels rather than in
      // the sea or in an enclave.
      let hit = false
      for (const poly of entry.contours!) {
        const n = poly.length / 2
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = poly[i * 2]
          const yi = poly[i * 2 + 1]
          const xj = poly[j * 2]
          const yj = poly[j * 2 + 1]
          if (
            yi > pt![1] !== yj > pt![1] &&
            pt![0] < ((xj - xi) * (pt![1] - yi)) / (yj - yi) + xi
          ) {
            hit = !hit
          }
        }
      }
      expect(hit, `${id} epicenter at ${pt} is outside the country`).toBe(true)
    }
  })

  it('holds multi-part countries together as one path', async () => {
    const raw = (await import('./eu-countries.svg?raw')).default
    const map = parseSvgPaths(raw, { tessellate: true })
    // Greece is the extreme: mainland plus the Aegean. One key, many contours.
    const greece = map.paths.get('gGRC')!
    expect(greece.contours!.length).toBeGreaterThan(20)
    // The Peloponnese and Crete are far enough apart that a merged AABB is
    // much wider than any single island.
    expect(greece.bounds.width).toBeGreaterThan(50)
  })
})
