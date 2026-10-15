import { describe, expect, it } from 'vitest'
import {
  IOS_CORNER_SMOOTHING,
  squircleCorner,
  squircleCorners,
  squirclePath2D,
  squircleShadowRadiusScale,
  squircleSvgPath,
} from './squircle'
import { cornerOutline, outlineDistance } from './squircleField'

// Paths from `getSvgPath` in figma-squircle (github.com/phamfoo/figma-squircle),
// the published port of Figma's corner smoothing, for the same rectangles.
const REFERENCE = [
  {
    w: 200,
    h: 120,
    radii: 40,
    smoothing: 0,
    path: 'M 160 0 c 0.0000 0 0.0000 0 0.0000 0.0000 a 40.0000 40.0000 0 0 1 40.0000 40.0000 c 0.0000 0.0000 0.0000 0.0000 0.0000 0.0000 L 200 80 c 0 0.0000 0 0.0000 0.0000 0.0000 a 40.0000 40.0000 0 0 1 -40.0000 40.0000 c 0.0000 0.0000 0.0000 0.0000 0.0000 0.0000 L 40 120 c 0.0000 0 0.0000 0 0.0000 0.0000 a 40.0000 40.0000 0 0 1 -40.0000 -40.0000 c 0.0000 0.0000 0.0000 0.0000 0.0000 0.0000 L 0 40 c 0 0.0000 0 0.0000 0.0000 0.0000 a 40.0000 40.0000 0 0 1 40.0000 -40.0000 c 0.0000 0.0000 0.0000 0.0000 0.0000 0.0000 Z',
  },
  {
    w: 200,
    h: 120,
    radii: 40,
    smoothing: 0.6,
    path: 'M 140 0 c 18.6377 0 27.9565 0 35.3073 3.0448 a 40.0000 40.0000 0 0 1 21.6478 21.6478 c 3.0448 7.3508 3.0448 16.6697 3.0448 35.3073 L 200 60 c 0 18.6377 0 27.9565 -3.0448 35.3073 a 40.0000 40.0000 0 0 1 -21.6478 21.6478 c -7.3508 3.0448 -16.6697 3.0448 -35.3073 3.0448 L 60 120 c -18.6377 0 -27.9565 0 -35.3073 -3.0448 a 40.0000 40.0000 0 0 1 -21.6478 -21.6478 c -3.0448 -7.3508 -3.0448 -16.6697 -3.0448 -35.3073 L 0 60 c 0 -18.6377 0 -27.9565 3.0448 -35.3073 a 40.0000 40.0000 0 0 1 21.6478 -21.6478 c 7.3508 -3.0448 16.6697 -3.0448 35.3073 -3.0448 Z',
  },
  {
    w: 60,
    h: 60,
    radii: 24,
    smoothing: 0.6,
    path: 'M 30 0 c 5.5759 0 8.3638 0 10.6822 0.4612 a 24.0000 24.0000 0 0 1 18.8567 18.8567 c 0.4612 2.3184 0.4612 5.1063 0.4612 10.6822 L 60 30 c 0 5.5759 0 8.3638 -0.4612 10.6822 a 24.0000 24.0000 0 0 1 -18.8567 18.8567 c -2.3184 0.4612 -5.1063 0.4612 -10.6822 0.4612 L 30 60 c -5.5759 0 -8.3638 0 -10.6822 -0.4612 a 24.0000 24.0000 0 0 1 -18.8567 -18.8567 c -0.4612 -2.3184 -0.4612 -5.1063 -0.4612 -10.6822 L 0 30 c 0 -5.5759 0 -8.3638 0.4612 -10.6822 a 24.0000 24.0000 0 0 1 18.8567 -18.8567 c 2.3184 -0.4612 5.1063 -0.4612 10.6822 -0.4612 Z',
  },
  {
    w: 200,
    h: 120,
    radii: [10, 40, 0, 60],
    smoothing: 0.6,
    path: 'M 136 0 c 22.4021 0 33.6032 0 42.1596 4.3597 a 40.0000 40.0000 0 0 1 17.4806 17.4806 c 4.3597 8.5565 4.3597 19.7575 4.3597 42.1596 L 200 120 l 0 0.0000 L 96 120 c -33.6032 0 -50.4047 0 -63.2394 -6.5396 a 60.0000 60.0000 0 0 1 -26.2210 -26.2210 c -6.5396 -12.8347 -6.5396 -29.6363 -6.5396 -63.2394 L 0 16 c 0 -5.6005 0 -8.4008 1.0899 -10.5399 a 10.0000 10.0000 0 0 1 4.3702 -4.3702 c 2.1391 -1.0899 4.9394 -1.0899 10.5399 -1.0899 Z',
  },
] as const

interface Segment {
  kind: 'line' | 'cubic' | 'arc'
  /** Absolute points: the control points then the end point. */
  points: number[][]
  /** For an arc, its radius. */
  radius?: number
}

/** Segments of the reference paths, which use M, L, relative c, l and a. */
function referenceSegments(path: string): Segment[] {
  const tokens = path.split(/\s+/)
  const segments: Segment[] = []
  let x = 0
  let y = 0
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M' || cmd === 'L') {
      x = num()
      y = num()
      if (cmd === 'L') segments.push({ kind: 'line', points: [[x, y]] })
    } else if (cmd === 'l') {
      x += num()
      y += num()
      segments.push({ kind: 'line', points: [[x, y]] })
    } else if (cmd === 'c') {
      const pts = [0, 1, 2].map(() => [x + num(), y + num()])
      ;[x, y] = pts[2]
      segments.push({ kind: 'cubic', points: pts })
    } else if (cmd === 'a') {
      const radius = num()
      i += 4
      x += num()
      y += num()
      segments.push({ kind: 'arc', points: [[x, y]], radius })
    }
  }
  return segments
}

/**
 * Segments of an outline from `squircleSvgPath`, which uses absolute M, L and
 * C.
 */
function outlineSegments(path: string): Segment[] {
  const segments: Segment[] = []
  for (const part of path.split(/(?=[MLCZ])/)) {
    const cmd = part[0]
    const v = part.slice(1).trim().split(/\s+/).map(Number)
    if (cmd === 'L') segments.push({ kind: 'line', points: [[v[0], v[1]]] })
    if (cmd === 'C') {
      segments.push({
        kind: 'cubic',
        points: [
          [v[0], v[1]],
          [v[2], v[3]],
          [v[4], v[5]],
        ],
      })
    }
  }
  return segments
}

/** Drop lines and curves of zero length, so both outlines list the same steps. */
function withoutEmpty(segments: Segment[], start: number[]): Segment[] {
  const out: Segment[] = []
  let at = start
  for (const s of segments) {
    const end = s.points[s.points.length - 1]
    if (Math.hypot(end[0] - at[0], end[1] - at[1]) > 1e-3) out.push(s)
    at = end
  }
  return out
}

function cubicAt(from: number[], s: Segment, t: number): number[] {
  const [p1, p2, p3] = s.points
  const u = 1 - t
  return [0, 1].map(
    (k) =>
      u * u * u * from[k] +
      3 * u * u * t * p1[k] +
      3 * u * t * t * p2[k] +
      t * t * t * p3[k],
  )
}

describe('squircleSvgPath', () => {
  for (const ref of REFERENCE) {
    it(`matches figma-squircle for ${ref.w}x${ref.h}, radii ${JSON.stringify(ref.radii)}, smoothing ${ref.smoothing}`, () => {
      const start = ref.path.split(/\s+/).slice(1, 3).map(Number)
      const expected = withoutEmpty(referenceSegments(ref.path), start)
      const actual = withoutEmpty(
        outlineSegments(
          squircleSvgPath(0, 0, ref.w, ref.h, ref.radii, ref.smoothing),
        ),
        start,
      )
      expect(actual.length).toBe(expected.length)
      let at = start
      for (let i = 0; i < expected.length; i++) {
        const want = expected[i]
        const got = actual[i]
        const end = got.points[got.points.length - 1]
        const wantEnd = want.points[want.points.length - 1]
        expect(end[0]).toBeCloseTo(wantEnd[0], 3)
        expect(end[1]).toBeCloseTo(wantEnd[1], 3)
        if (want.kind === 'cubic') {
          for (let k = 0; k < 3; k++) {
            expect(got.points[k][0]).toBeCloseTo(want.points[k][0], 3)
            expect(got.points[k][1]).toBeCloseTo(want.points[k][1], 3)
          }
        }
        if (want.kind === 'arc') {
          // The arc is one cubic. Every point on it stays on the circle
          // through its two ends, within 0.03% of the radius.
          const r = want.radius!
          const mid = [(at[0] + end[0]) / 2, (at[1] + end[1]) / 2]
          const half = Math.hypot(end[0] - at[0], end[1] - at[1]) / 2
          const toCenter = Math.sqrt(r * r - half * half)
          const chord = [
            (end[0] - at[0]) / (2 * half),
            (end[1] - at[1]) / (2 * half),
          ]
          // Clockwise outline, so the center is to the right of the chord.
          const center = [
            mid[0] - chord[1] * toCenter,
            mid[1] + chord[0] * toCenter,
          ]
          for (let t = 0; t <= 1; t += 0.125) {
            const p = cubicAt(at, got, t)
            const off = Math.hypot(p[0] - center[0], p[1] - center[1]) - r
            expect(Math.abs(off)).toBeLessThan(r * 3e-4)
          }
        }
        at = end
      }
    })
  }
})

describe('squircleCorner', () => {
  it('is a plain circular corner at zero smoothing', () => {
    const c = squircleCorner(40, 0, 100)
    expect(c.extent).toBe(40)
    expect(c.arcSpan).toBeCloseTo(40)
    expect(c.a + c.b + c.c + c.d).toBeCloseTo(0)
  })

  it('uses (1 + smoothing) times the radius of each side when it fits', () => {
    const c = squircleCorner(40, IOS_CORNER_SMOOTHING, 100)
    expect(c.extent).toBeCloseTo(64)
    expect(c.smoothing).toBeCloseTo(0.6)
  })

  it('reduces smoothing before the radius when a side is short', () => {
    const c = squircleCorner(40, 0.6, 50)
    expect(c.extent).toBe(50)
    expect(c.smoothing).toBeCloseTo(0.25)
    expect(c.radius).toBe(40)
  })

  it('spends the easing length two thirds before the middle handle', () => {
    const c = squircleCorner(40, 0.6, 100)
    expect(c.a).toBeCloseTo(2 * c.b)
    expect(c.a + c.b + c.c + c.d + c.arcSpan).toBeCloseTo(c.extent)
  })
})

describe('squircleCorners', () => {
  it('fits every corner to half the shorter side when the radii are equal', () => {
    const corners = squircleCorners(200, 60, 50, 0.6)
    for (const c of corners) {
      expect(c.radius).toBe(30)
      expect(c.smoothing).toBe(0)
    }
  })

  it('gives larger corners their share of a side first', () => {
    const [tl, tr, br, bl] = squircleCorners(200, 120, [10, 40, 0, 60], 0.6)
    expect(br.extent).toBe(0)
    expect(tr.extent).toBeCloseTo(64)
    expect(bl.radius).toBe(60)
    expect(tl.extent).toBeCloseTo(16)
  })
})

describe('squircleShadowRadiusScale', () => {
  /** A separable Gaussian blur of an `n` x `n` image, edges clamped. */
  function blur(image: Float64Array, n: number, sigma: number): Float64Array {
    const reach = Math.ceil(sigma * 3)
    const kernel: number[] = []
    let total = 0
    for (let i = -reach; i <= reach; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma))
      kernel.push(v)
      total += v
    }
    const pass = (src: Float64Array, horizontal: boolean) => {
      const out = new Float64Array(n * n)
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let sum = 0
          for (let i = -reach; i <= reach; i++) {
            const sx = horizontal ? Math.min(n - 1, Math.max(0, x + i)) : x
            const sy = horizontal ? y : Math.min(n - 1, Math.max(0, y + i))
            sum += src[sy * n + sx] * kernel[i + reach]
          }
          out[y * n + x] = sum / total
        }
      }
      return out
    }
    return pass(pass(image, true), false)
  }

  /**
   * The largest difference, out of 1, between a blurred smooth corner and the
   * blurred circular corner of the area-matched radius, for a corner of radius
   * `R` px and a blur of `sigma` px.
   */
  function shadowMismatch(smoothing: number, R: number, sigma: number): number {
    const outline = cornerOutline(smoothing)
    const radius = squircleShadowRadiusScale(smoothing)
    const n = 6 * R
    const smooth = new Float64Array(n * n)
    const circular = new Float64Array(n * n)
    const samples = 4
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let inSmooth = 0
        let inCircular = 0
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            // Insets in units of the radius, from -2 to 4.
            const ix = (x + (sx + 0.5) / samples) / R - 2
            const iy = (y + (sy + 0.5) / samples) / R - 2
            if (ix <= 0 || iy <= 0) continue
            // Past an inset of 2 the corner's curve has ended, so only nearer
            // points need measuring against it.
            if (ix >= 2 || iy >= 2 || outlineDistance(outline, ix, iy)[0] < 0) {
              inSmooth++
            }
            const dx = radius - ix
            const dy = radius - iy
            if (!(
              ix < radius &&
              iy < radius &&
              dx * dx + dy * dy > radius * radius
            )) {
              inCircular++
            }
          }
        }
        smooth[y * n + x] = inSmooth / samples ** 2
        circular[y * n + x] = inCircular / samples ** 2
      }
    }
    const a = blur(smooth, n, sigma)
    const b = blur(circular, n, sigma)
    let worst = 0
    for (let i = 0; i < n * n; i++)
      worst = Math.max(worst, Math.abs(a[i] - b[i]))
    return worst
  }

  // The thresholds `Gfx2D.shadowRoundRect` documents: a blur sigma of at least
  // 0.3 of the radius at the iOS smoothing, and 0.5 at full smoothing, keeps
  // the circular stand-in within about 2/255 of the smooth corner's shadow.
  it('matches the iOS corner within 2.5/255 from a sigma of 0.3 radius', () => {
    expect(shadowMismatch(IOS_CORNER_SMOOTHING, 24, 0.3 * 24)).toBeLessThan(
      2.5 / 255,
    )
  })

  it('matches the fully smoothed corner within 2.5/255 from a sigma of 0.5 radius', () => {
    expect(shadowMismatch(1, 24, 0.5 * 24)).toBeLessThan(2.5 / 255)
  })

  it('is exact for a circular corner', () => {
    expect(squircleShadowRadiusScale(0)).toBeCloseTo(1, 3)
  })
})

describe('squirclePath2D', () => {
  it('registers a tessellation so the GPU backend can draw the path', async () => {
    const { getPathTessellation } = await import('./PathTessellationRegistry')
    const path = squirclePath2D(0, 0, 120, 120, 27, IOS_CORNER_SMOOTHING)
    const geometry = getPathTessellation(path)
    expect(geometry).toBeDefined()
    expect(geometry!.indices.length).toBeGreaterThan(0)
  })
})
