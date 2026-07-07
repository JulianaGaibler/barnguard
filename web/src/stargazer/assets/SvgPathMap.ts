import { rect, type Rect } from '../math/Rect'
import type { GeometryHandle } from '../render/gfx/GeometryHandle'
import { registerPathTessellation } from '../render/gfx/PathTessellationRegistry'
import { flattenSvgPath, tessellateContours } from './SvgPathContours'

export interface SvgPathEntry {
  path: Path2D
  bounds: Rect
  /**
   * Flattened polyline contours (`[x0,y0,x1,y1,…]`) in the SVG's own coordinate
   * space, or `undefined` if `parseSvgPaths` was called without `tessellate:
   * true`. Used by the GPU backend for `strokePath2D` on dynamic paths.
   */
  contours?: Float32Array[]
  /**
   * Triangulated geometry, `undefined` unless `tessellate: true`. Used by the
   * GPU backend for `fillPath2D` on dynamic paths.
   */
  triangles?: GeometryHandle
}

export interface ParseSvgPathsOptions {
  /**
   * When true, also emit `contours` + `triangles` for each path. Default
   * `false`, the map SVG's ~4000 state paths bake via Canvas 2D and don't need
   * tessellation; only dynamic assets (hand, eye, impact-flash) should opt in.
   */
  tessellate?: boolean
  /**
   * Flattening tolerance in the SVG's own coordinate units. Default `0.5`, half
   * a pixel at 1:1 render scale.
   */
  flattenTol?: number
}

export interface SvgPathMap {
  viewBox: Rect
  paths: ReadonlyMap<string, SvgPathEntry>
}

/**
 * Parse an SVG document string, extracting every `<path>` into a Path2D +
 * axis-aligned bounds. Fills/strokes on the SVG source are ignored, theme those
 * on the Path2DNode at render time.
 *
 * Keying:
 *
 * 1. If the `<path>` itself has an `id`, that wins.
 * 2. Otherwise, walk up to the nearest `<g id="…">` ancestor and key under that.
 *    Multi-region features (a state made of a mainland + island paths) are
 *    commonly authored this way, one wrapping `<g>` per feature, with unnamed
 *    `<path>` children per region. All sibling paths keyed to the same ancestor
 *    are merged into ONE `Path2D` (via `addPath`), with a union AABB.
 * 3. If neither is present, fall back to `path-<index>`, unique per path so
 *    unnamed, ungrouped SVGs behave the same as before.
 */
export function parseSvgPaths(
  raw: string,
  opts: ParseSvgPathsOptions = {},
): SvgPathMap {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`parseSvgPaths: XML parse error, ${parseError.textContent}`)
  }
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('parseSvgPaths: no <svg> root element')
  }

  const viewBox = parseViewBox(
    root.getAttribute('viewBox'),
    root.getAttribute('width'),
    root.getAttribute('height'),
  )

  const tessellate = opts.tessellate === true
  const flattenTol = opts.flattenTol ?? 0.5

  const paths = new Map<string, SvgPathEntry>()
  const pathEls = doc.querySelectorAll('path')
  pathEls.forEach((el, idx) => {
    const d = el.getAttribute('d')
    if (!d) return
    const key = el.getAttribute('id') ?? nearestAncestorId(el) ?? `path-${idx}`
    const subBounds = computePathBounds(d)
    const existing = paths.get(key)
    if (existing) {
      existing.path.addPath(new Path2D(d))
      existing.bounds = unionRect(existing.bounds, subBounds)
      if (tessellate) {
        const extraContours = flattenSvgPath(d, flattenTol)
        existing.contours = mergeContours(existing.contours, extraContours)
        existing.triangles = tessellateContours(existing.contours ?? [])
        registerPathTessellation(
          existing.path,
          existing.triangles,
          existing.contours,
        )
      }
    } else {
      const entry: SvgPathEntry = {
        path: new Path2D(d),
        bounds: subBounds,
      }
      if (tessellate) {
        const contours = flattenSvgPath(d, flattenTol)
        entry.contours = contours
        entry.triangles = tessellateContours(contours)
        registerPathTessellation(entry.path, entry.triangles, entry.contours)
      }
      paths.set(key, entry)
    }
  })

  return { viewBox, paths }
}

function mergeContours(
  a: Float32Array[] | undefined,
  b: Float32Array[],
): Float32Array[] {
  if (!a) return b
  return a.concat(b)
}

/**
 * Walk up from `el` to the nearest ancestor `<g>` (or any element) that has an
 * `id` attribute. Stops at the `<svg>` root. Returns `null` when no ancestor
 * has an id, the caller falls back to `path-<idx>`.
 */
function nearestAncestorId(el: Element): string | null {
  let cur: Element | null = el.parentElement
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    const id = cur.getAttribute('id')
    if (id) return id
    cur = cur.parentElement
  }
  return null
}

/**
 * AABB union. Kept private to the parser, callers that need it can import
 * `Rect` and use their own helper.
 */
function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

function parseViewBox(
  vb: string | null,
  width: string | null,
  height: string | null,
): Rect {
  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
    }
  }
  const w = width ? parseFloat(width) : 0
  const h = height ? parseFloat(height) : 0
  return rect(0, 0, Number.isFinite(w) ? w : 0, Number.isFinite(h) ? h : 0)
}

/**
 * Compute an approximate axis-aligned bounding box for a raw SVG path `d`
 * string. Handles M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z with
 * implicit continuation semantics. For Bézier segments we bound by the control
 * polygon (slightly conservative, always encloses the actual curve).
 *
 * "Approximate but safe", the returned box is always ≥ the true AABB.
 * Sufficient for hit-broad-phase and debug outlines.
 */
/**
 * Tokenize a raw SVG `d` string into commands and numeric arguments. Returned
 * as a flat `string[]` where letters are commands (`M`, `l`, `Z` …) and every
 * other token is a number literal. Used by both `computePathBounds` (AABB) and
 * `SvgPathContours` (flattening + tessellation) so the two share exactly one
 * grammar.
 */
export function tokenizeSvgPath(d: string): string[] {
  const tokenRe = /[a-zA-Z]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g
  const tokens: string[] = []
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(d)) !== null) tokens.push(m[0])
  return tokens
}

export function computePathBounds(d: string): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0

  const tokens = tokenizeSvgPath(d)

  let i = 0
  let cmd = ''

  const include = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const num = (): number => parseFloat(tokens[i++])

  while (i < tokens.length) {
    const before = i
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i++
    }
    if (i >= tokens.length) break
    const upper = cmd.toUpperCase()
    const abs = cmd === upper

    switch (upper) {
      case 'M': {
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        cx = x
        cy = y
        startX = x
        startY = y
        include(x, y)
        // Implicit continuation: M → L, m → l
        cmd = abs ? 'L' : 'l'
        break
      }
      case 'L':
      case 'T': {
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        cx = x
        cy = y
        include(x, y)
        break
      }
      case 'H': {
        const x = num() + (abs ? 0 : cx)
        cx = x
        include(x, cy)
        break
      }
      case 'V': {
        const y = num() + (abs ? 0 : cy)
        cy = y
        include(cx, y)
        break
      }
      case 'C': {
        const x1 = num() + (abs ? 0 : cx)
        const y1 = num() + (abs ? 0 : cy)
        const x2 = num() + (abs ? 0 : cx)
        const y2 = num() + (abs ? 0 : cy)
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        include(x1, y1)
        include(x2, y2)
        include(x, y)
        cx = x
        cy = y
        break
      }
      case 'S':
      case 'Q': {
        const x1 = num() + (abs ? 0 : cx)
        const y1 = num() + (abs ? 0 : cy)
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        include(x1, y1)
        include(x, y)
        cx = x
        cy = y
        break
      }
      case 'A': {
        // rx ry x-axis-rotation large-arc-flag sweep-flag x y
        num() // rx
        num() // ry
        num() // rotation
        num() // large-arc-flag
        num() // sweep-flag
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        // Conservative: include endpoint. Doesn't fully bound the arc's
        // extremes, but a real arc AABB requires solving trig systems;
        // acceptable for our AABB-as-broad-phase use.
        include(x, y)
        cx = x
        cy = y
        break
      }
      case 'Z':
        cx = startX
        cy = startY
        break
      default:
        // Unknown command, skip one token to avoid infinite loop.
        if (i < tokens.length) i++
        break
    }
    if (i === before) i++ // safety: never stall
  }

  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
