// Turns Lottie JSON into the normalized model in `types.ts`. Parsing is
// forgiving. A field the loader cannot use is skipped and listed in the
// animation's `diagnostics`, and only a file with no usable composition
// (missing size, frame rate or range) throws.

import {
  EasingCache,
  constantProp,
  parsePathProp,
  parseProp,
  type ValueProp,
} from '../anim/props'
import type {
  LottieAnimation,
  LottieAsset,
  LottieDiagnostic,
  LottieFillRule,
  LottieFont,
  LottieGradient,
  LottieLayer,
  LottieLayerBase,
  LottieMarker,
  LottieMask,
  LottieMaskMode,
  LottieMatteMode,
  LottieGlyph,
  LottieShapeItem,
  LottieTextDocument,
  LottieStrokeStyle,
  LottieTransform,
} from './types'

type Json = unknown
type Obj = Record<string, Json>

function isObj(v: Json): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(o: Obj, key: string, fallback: number): number {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(o: Obj, key: string, fallback = ''): string {
  const v = o[key]
  return typeof v === 'string' ? v : fallback
}

/** Parse context shared by one `parseLottie` call. */
interface Ctx {
  cache: EasingCache
  diagnostics: LottieDiagnostic[]
  slotIds: Set<string>
  /** Properties that carry a slot id, by id. */
  slotProps: Map<string, ValueProp[]>
  /** Multiplier that brings colors to the 0 to 1 range. */
  colorScale: number
  /** Name of the layer being parsed, for diagnostics. */
  layer: string
  /** Codes already reported for the current layer. */
  reported: Set<string>
}

function report(ctx: Ctx, code: string, message: string): void {
  const key = `${ctx.layer}|${code}`
  if (ctx.reported.has(key)) return
  ctx.reported.add(key)
  ctx.diagnostics.push({
    code,
    message,
    ...(ctx.layer ? { layer: ctx.layer } : {}),
  })
}

function prop(ctx: Ctx, json: Json, dims: number, scale = 1): ValueProp {
  if (isObj(json)) {
    if (typeof json.x === 'string' && json.x.length > 0) {
      report(
        ctx,
        'expression',
        'An expression was ignored. The property keeps its keyframed value.',
      )
    }
    if (typeof json.sid === 'string') ctx.slotIds.add(json.sid)
  }
  const p = parseProp(json, dims, ctx.cache, scale)
  if (p.slotId) {
    let list = ctx.slotProps.get(p.slotId)
    if (!list) ctx.slotProps.set(p.slotId, (list = []))
    list.push(p)
  }
  return p
}

function optProp(
  ctx: Ctx,
  o: Obj,
  key: string,
  dims: number,
): ValueProp | null {
  return key in o ? prop(ctx, o[key], dims) : null
}

function color(ctx: Ctx, json: Json): ValueProp {
  return prop(ctx, json, 4, ctx.colorScale)
}

// --- transform ----------------------------------------------------------------

function parseTransform(
  ctx: Ctx,
  ks: Json,
  rotationFallback?: Json,
): LottieTransform {
  const o = isObj(ks) ? ks : {}
  const p = o.p
  const split = isObj(p) && p.s === true
  const rotation = 'r' in o ? o.r : (rotationFallback ?? o.rz)
  return {
    anchor: 'a' in o ? prop(ctx, o.a, 2) : constantProp([0, 0]),
    position: split ? null : 'p' in o ? prop(ctx, p, 2) : constantProp([0, 0]),
    positionX: split && isObj(p) ? prop(ctx, p.x, 1) : null,
    positionY: split && isObj(p) ? prop(ctx, p.y, 1) : null,
    scale: 's' in o ? prop(ctx, o.s, 2) : constantProp([100, 100]),
    rotation:
      rotation !== undefined ? prop(ctx, rotation, 1) : constantProp([0]),
    skew: 'sk' in o ? prop(ctx, o.sk, 1) : constantProp([0]),
    skewAxis: 'sa' in o ? prop(ctx, o.sa, 1) : constantProp([0]),
    opacity: 'o' in o ? prop(ctx, o.o, 1) : constantProp([100]),
  }
}

// --- shapes -------------------------------------------------------------------

const CAPS: CanvasLineCap[] = ['butt', 'butt', 'round', 'square']
const JOINS: CanvasLineJoin[] = ['miter', 'miter', 'round', 'bevel']

function fillRule(o: Obj): LottieFillRule {
  return num(o, 'r', 1) === 2 ? 'evenodd' : 'nonzero'
}

function parseGradient(ctx: Ctx, g: Json): LottieGradient {
  const o = isObj(g) ? g : {}
  const k = isObj(o.k) ? o.k : {}
  // The flat array has the same length in every keyframe. Its length is the
  // color stops times four, plus the alpha stops times two when present.
  let dims = 0
  const kk = k.k
  if (Array.isArray(kk)) {
    const first = kk[0]
    if (isObj(first) && Array.isArray(first.s)) dims = first.s.length
    else if (typeof first === 'number') dims = kk.length
  }
  const stops = num(o, 'p', Math.floor(dims / 4))
  return { stops, data: prop(ctx, o.k, Math.max(dims, stops * 4)) }
}

function parseStrokeStyle(ctx: Ctx, o: Obj): LottieStrokeStyle {
  const dashes: LottieStrokeStyle['dashes'] = []
  if (Array.isArray(o.d)) {
    for (const d of o.d) {
      if (!isObj(d)) continue
      const kind = d.n
      if (kind === 'd' || kind === 'g' || kind === 'o') {
        dashes.push({ kind, value: prop(ctx, d.v, 1) })
      }
    }
  }
  return {
    width: prop(ctx, o.w, 1),
    opacity: 'o' in o ? prop(ctx, o.o, 1) : constantProp([100]),
    cap: CAPS[num(o, 'lc', 2)] ?? 'round',
    join: JOINS[num(o, 'lj', 2)] ?? 'round',
    miterLimit: num(o, 'ml', 4),
    miterLimitProp: 'ml2' in o ? prop(ctx, o.ml2, 1) : null,
    dashes,
  }
}

function parseShapeItems(ctx: Ctx, list: Json): LottieShapeItem[] {
  const out: LottieShapeItem[] = []
  if (!Array.isArray(list)) return out
  for (const raw of list) {
    if (!isObj(raw) || raw.hd === true) continue
    const item = parseShapeItem(ctx, raw)
    if (item) out.push(item)
  }
  return out
}

function parseShapeItem(ctx: Ctx, o: Obj): LottieShapeItem | null {
  const base = { name: str(o, 'nm'), direction: num(o, 'd', 1) }
  switch (o.ty) {
    case 'gr':
      return { ...base, kind: 'group', items: parseShapeItems(ctx, o.it) }
    case 'sh':
      return { ...base, kind: 'path', path: parsePathProp(o.ks, ctx.cache) }
    case 'rc':
      return {
        ...base,
        kind: 'rect',
        position: prop(ctx, o.p, 2),
        size: prop(ctx, o.s, 2),
        roundness: 'r' in o ? prop(ctx, o.r, 1) : constantProp([0]),
      }
    case 'el':
      return {
        ...base,
        kind: 'ellipse',
        position: prop(ctx, o.p, 2),
        size: prop(ctx, o.s, 2),
      }
    case 'sr':
      return {
        ...base,
        kind: 'star',
        starType: num(o, 'sy', 1),
        position: prop(ctx, o.p, 2),
        points: prop(ctx, o.pt, 1),
        rotation: 'r' in o ? prop(ctx, o.r, 1) : constantProp([0]),
        innerRadius: optProp(ctx, o, 'ir', 1),
        outerRadius: prop(ctx, o.or, 1),
        innerRoundness: optProp(ctx, o, 'is', 1),
        outerRoundness: 'os' in o ? prop(ctx, o.os, 1) : constantProp([0]),
      }
    case 'fl':
      return {
        ...base,
        kind: 'fill',
        color: color(ctx, o.c),
        opacity: 'o' in o ? prop(ctx, o.o, 1) : constantProp([100]),
        rule: fillRule(o),
      }
    case 'gf':
      return {
        ...base,
        kind: 'gradient-fill',
        gradientType: num(o, 't', 1),
        start: prop(ctx, o.s, 2),
        end: prop(ctx, o.e, 2),
        highlightLength: optProp(ctx, o, 'h', 1),
        highlightAngle: optProp(ctx, o, 'a', 1),
        gradient: parseGradient(ctx, o.g),
        opacity: 'o' in o ? prop(ctx, o.o, 1) : constantProp([100]),
        rule: fillRule(o),
      }
    case 'st':
      return {
        ...base,
        ...parseStrokeStyle(ctx, o),
        kind: 'stroke',
        color: color(ctx, o.c),
      }
    case 'gs':
      return {
        ...base,
        ...parseStrokeStyle(ctx, o),
        kind: 'gradient-stroke',
        gradientType: num(o, 't', 1),
        start: prop(ctx, o.s, 2),
        end: prop(ctx, o.e, 2),
        highlightLength: optProp(ctx, o, 'h', 1),
        highlightAngle: optProp(ctx, o, 'a', 1),
        gradient: parseGradient(ctx, o.g),
      }
    case 'tm':
      return {
        ...base,
        kind: 'trim',
        start: 's' in o ? prop(ctx, o.s, 1) : constantProp([0]),
        end: 'e' in o ? prop(ctx, o.e, 1) : constantProp([100]),
        offset: 'o' in o ? prop(ctx, o.o, 1) : constantProp([0]),
        multiple: num(o, 'm', 1),
      }
    case 'rp': {
      const t = isObj(o.tr) ? o.tr : {}
      return {
        ...base,
        kind: 'repeater',
        copies: prop(ctx, o.c, 1),
        offset: 'o' in o ? prop(ctx, o.o, 1) : constantProp([0]),
        composite: num(o, 'm', 1),
        transform: {
          anchor: 'a' in t ? prop(ctx, t.a, 2) : constantProp([0, 0]),
          position: 'p' in t ? prop(ctx, t.p, 2) : constantProp([0, 0]),
          scale: 's' in t ? prop(ctx, t.s, 2) : constantProp([100, 100]),
          rotation: 'r' in t ? prop(ctx, t.r, 1) : constantProp([0]),
          startOpacity: 'so' in t ? prop(ctx, t.so, 1) : constantProp([100]),
          endOpacity: 'eo' in t ? prop(ctx, t.eo, 1) : constantProp([100]),
        },
      }
    }
    case 'rd':
      return { ...base, kind: 'round-corners', radius: prop(ctx, o.r, 1) }
    case 'op':
      return {
        ...base,
        kind: 'offset-path',
        amount: prop(ctx, o.a, 1),
        miterLimit: 'ml' in o ? prop(ctx, o.ml, 1) : constantProp([4]),
        join: num(o, 'lj', 1),
      }
    case 'zz':
      return {
        ...base,
        kind: 'zig-zag',
        size: prop(ctx, o.s, 1),
        frequency: prop(ctx, o.r, 1),
        pointType: num(o, 'pt', 1),
      }
    case 'pb':
      return { ...base, kind: 'pucker-bloat', amount: prop(ctx, o.a, 1) }
    case 'mm':
      return { ...base, kind: 'merge-paths', mode: num(o, 'mm', 1) }
    case 'tw':
      return { ...base, kind: 'twist' }
    case 'tr':
      return { ...base, kind: 'transform', transform: parseTransform(ctx, o) }
    default:
      report(
        ctx,
        'shape-item',
        `Shape item '${String(o.ty)}' is not supported.`,
      )
      return null
  }
}

// --- layers -------------------------------------------------------------------

const BLEND_MODES: Array<GlobalCompositeOperation | null> = [
  null,
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'lighter',
]

const MASK_MODES: Record<string, LottieMaskMode> = {
  a: 'add',
  s: 'subtract',
  i: 'intersect',
  l: 'lighten',
  d: 'darken',
  f: 'difference',
  n: 'none',
}

const MATTE_MODES: LottieMatteMode[] = [
  'none',
  'alpha',
  'inverted-alpha',
  'luma',
  'inverted-luma',
]

function parseMasks(ctx: Ctx, list: Json): LottieMask[] {
  const out: LottieMask[] = []
  if (!Array.isArray(list)) return out
  for (const m of list) {
    if (!isObj(m)) continue
    out.push({
      mode: MASK_MODES[str(m, 'mode', 'a')] ?? 'add',
      inverted: m.inv === true,
      path: parsePathProp(m.pt, ctx.cache),
      opacity: 'o' in m ? prop(ctx, m.o, 1) : constantProp([100]),
      expansion: 'x' in m ? prop(ctx, m.x, 1) : constantProp([0]),
    })
  }
  return out
}

/** Effect types that only carry expression controls. */
const CONTROL_EFFECT_MAX = 10

function parseLayer(ctx: Ctx, o: Obj): LottieLayer | null {
  const ty = num(o, 'ty', -1)
  const name = str(o, 'nm', `Layer ${num(o, 'ind', 0)}`)
  ctx.layer = name
  const ks = isObj(o.ks) ? o.ks : {}
  if (o.ddd === 1) {
    const flat = (k: string): boolean => !(k in ks)
    if (!flat('rx') || !flat('ry') || !flat('or')) {
      report(
        ctx,
        'layer-3d',
        '3D layer properties other than rotation were ignored.',
      )
    }
  }
  if (o.ct === 1) {
    report(
      ctx,
      'collapse-transform',
      'Collapse transformations is not supported.',
    )
  }
  if (Array.isArray(o.ef)) {
    for (const e of o.ef) {
      if (isObj(e) && num(e, 'ty', 0) > CONTROL_EFFECT_MAX) {
        report(ctx, 'effect', 'A layer effect was ignored.')
        break
      }
    }
  }
  if (Array.isArray(o.sy) && o.sy.length > 0) {
    report(ctx, 'layer-style', 'A layer style was ignored.')
  }
  const bm = num(o, 'bm', 0)
  if (bm === 17) {
    report(ctx, 'blend-mode', 'The hard mix blend mode draws as normal.')
  }
  const base: Omit<LottieLayerBase, 'type'> = {
    name,
    index: num(o, 'ind', 0),
    parent: num(o, 'parent', -1),
    hidden: o.hd === true,
    inPoint: num(o, 'ip', 0),
    outPoint: num(o, 'op', 0),
    startTime: num(o, 'st', 0),
    stretch: num(o, 'sr', 1) || 1,
    transform: parseTransform(ctx, ks),
    autoOrient: o.ao === 1,
    masks: o.hasMask === false ? [] : parseMasks(ctx, o.masksProperties),
    matteMode: MATTE_MODES[num(o, 'tt', 0)] ?? 'none',
    matteSource: 'tp' in o ? num(o, 'tp', -1) : -1,
    isMatte: o.td === 1,
    blendMode: BLEND_MODES[bm] ?? null,
    slotId: null,
  }
  switch (ty) {
    case 0:
      return {
        ...base,
        type: 'precomp',
        refId: str(o, 'refId'),
        width: num(o, 'w', 0),
        height: num(o, 'h', 0),
        timeRemap: 'tm' in o ? prop(ctx, o.tm, 1) : null,
      }
    case 1:
      return {
        ...base,
        type: 'solid',
        color: str(o, 'sc', '#000000'),
        width: num(o, 'sw', 0),
        height: num(o, 'sh', 0),
      }
    case 2:
      return { ...base, type: 'image', refId: str(o, 'refId') }
    case 3:
      return { ...base, type: 'null' }
    case 4:
      return { ...base, type: 'shape', shapes: parseShapeItems(ctx, o.shapes) }
    case 5:
      return {
        ...base,
        type: 'text',
        documents: parseTextDocuments(o.t),
        animators: isObj(o.t) && Array.isArray(o.t.a) ? o.t.a.length : 0,
      }
    case 6:
      report(ctx, 'audio-layer', 'Audio layers are ignored.')
      return { ...base, type: 'unsupported' }
    case 13:
      report(ctx, 'camera-layer', 'Camera layers are ignored.')
      return { ...base, type: 'unsupported' }
    case 15:
      report(ctx, 'data-layer', 'Data layers are ignored.')
      return { ...base, type: 'unsupported' }
    default:
      report(ctx, 'layer-type', `Layer type ${ty} is not supported.`)
      return { ...base, type: 'unsupported' }
  }
}

function parseTextDocuments(t: Json): LottieTextDocument[] {
  const out: LottieTextDocument[] = []
  const d = isObj(t) && isObj(t.d) ? t.d : null
  const k = d?.k
  const list = Array.isArray(k) ? k : k !== undefined ? [{ s: k, t: 0 }] : []
  for (const kf of list) {
    if (!isObj(kf) || !isObj(kf.s)) continue
    const s = kf.s
    const color = (v: Json): number[] | null =>
      Array.isArray(v) && v.length >= 3
        ? [Number(v[0]), Number(v[1]), Number(v[2])]
        : null
    out.push({
      frame: num(kf, 't', 0),
      text: str(s, 't'),
      font: str(s, 'f'),
      size: num(s, 's', 12),
      justify: num(s, 'j', 0),
      tracking: num(s, 'tr', 0),
      lineHeight: num(s, 'lh', num(s, 's', 12) * 1.2),
      fill: color(s.fc),
      stroke: color(s.sc),
      strokeWidth: num(s, 'sw', 0),
    })
  }
  return out.sort((a, b) => a.frame - b.frame)
}

function parseGlyphs(ctx: Ctx, list: Json): LottieGlyph[] {
  const out: LottieGlyph[] = []
  if (!Array.isArray(list)) return out
  for (const c of list) {
    if (!isObj(c) || !isObj(c.data)) continue
    out.push({
      char: str(c, 'ch'),
      family: str(c, 'fFamily'),
      style: str(c, 'style'),
      size: num(c, 'size', 100),
      width: num(c, 'w', 0),
      shapes: parseShapeItems(ctx, c.data.shapes),
    })
  }
  return out
}

function parseLayers(ctx: Ctx, list: Json): LottieLayer[] {
  const out: LottieLayer[] = []
  if (!Array.isArray(list)) return out
  for (const raw of list) {
    if (!isObj(raw)) continue
    const layer = parseLayer(ctx, raw)
    if (layer) out.push(layer)
  }
  ctx.layer = ''
  return out
}

// --- composition ----------------------------------------------------------------

/** Compare `a.b.c` version strings. */
function versionBefore(
  version: string,
  major: number,
  minor: number,
  patch: number,
): boolean {
  const parts = version.split('.').map((x) => parseInt(x, 10))
  if (parts.some((p) => Number.isNaN(p)) || parts.length < 3) return false
  const [a, b, c] = parts
  if (a !== major) return a < major
  if (b !== minor) return b < minor
  return c < patch
}

function parseAssets(ctx: Ctx, list: Json): Map<string, LottieAsset> {
  const out = new Map<string, LottieAsset>()
  if (!Array.isArray(list)) return out
  for (const a of list) {
    if (!isObj(a)) continue
    const id = String(a.id ?? '')
    if (!id) continue
    if (Array.isArray(a.layers)) {
      out.set(id, { id, layers: parseLayers(ctx, a.layers), image: null })
    } else if (typeof a.p === 'string') {
      out.set(id, {
        id,
        layers: null,
        image: {
          path: a.p,
          dir: str(a, 'u'),
          embedded: a.e === 1,
          width: num(a, 'w', 0),
          height: num(a, 'h', 0),
        },
      })
    }
  }
  return out
}

function parseFonts(json: Json): LottieFont[] {
  if (!isObj(json) || !Array.isArray(json.list)) return []
  const out: LottieFont[] = []
  for (const f of json.list) {
    if (!isObj(f)) continue
    out.push({
      family: str(f, 'fFamily'),
      name: str(f, 'fName'),
      style: str(f, 'fStyle'),
      path: str(f, 'fPath'),
      origin: num(f, 'origin', 0),
    })
  }
  return out
}

/**
 * Parse Lottie JSON, given as an object or a string, into a
 * {@link LottieAnimation}.
 *
 * Throws when the data has no usable composition. Features the engine does not
 * support do not throw. They are listed in `diagnostics`.
 *
 * @example
 *   const anim = parseLottie(await (await fetch('/spinner.json')).text())
 *   console.log(anim.totalFrames, anim.diagnostics)
 */
export function parseLottie(source: unknown): LottieAnimation {
  const json: Json = typeof source === 'string' ? JSON.parse(source) : source
  if (!isObj(json)) throw new Error('parseLottie: expected a JSON object')
  const width = num(json, 'w', 0)
  const height = num(json, 'h', 0)
  const frameRate = num(json, 'fr', 0)
  const inPoint = num(json, 'ip', NaN)
  const outPoint = num(json, 'op', NaN)
  if (width <= 0 || height <= 0)
    throw new Error('parseLottie: missing size (w, h)')
  if (frameRate <= 0) throw new Error('parseLottie: missing frame rate (fr)')
  if (
    !Number.isFinite(inPoint) ||
    !Number.isFinite(outPoint) ||
    outPoint <= inPoint
  ) {
    throw new Error('parseLottie: missing or empty frame range (ip, op)')
  }
  const version = str(json, 'v')
  const ctx: Ctx = {
    cache: new EasingCache(),
    diagnostics: [],
    slotIds: new Set(),
    slotProps: new Map(),
    colorScale: versionBefore(version, 4, 1, 9) ? 1 / 255 : 1,
    layer: '',
    reported: new Set(),
  }
  const assets = parseAssets(ctx, json.assets)
  const layers = parseLayers(ctx, json.layers)

  if (isObj(json.slots))
    for (const id of Object.keys(json.slots)) ctx.slotIds.add(id)

  const markers: LottieMarker[] = []
  if (Array.isArray(json.markers)) {
    for (const m of json.markers) {
      if (!isObj(m)) continue
      markers.push({
        name: str(m, 'cm'),
        time: num(m, 'tm', 0),
        duration: num(m, 'dr', 0),
      })
    }
  }

  const totalFrames = outPoint - inPoint
  return {
    width,
    height,
    frameRate,
    inPoint,
    outPoint,
    totalFrames,
    durationMs: (totalFrames / frameRate) * 1000,
    markers,
    layerNames: layers.map((l) => l.name),
    slotIds: [...ctx.slotIds],
    slotProps: ctx.slotProps,
    diagnostics: ctx.diagnostics,
    layers,
    assets,
    fonts: parseFonts(json.fonts),
    glyphs: parseGlyphs(ctx, json.chars),
  }
}
