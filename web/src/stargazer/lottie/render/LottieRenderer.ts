// Compiles a parsed Lottie animation and evaluates it frame by frame.
//
// The renderer compiles the animation once into a tree of layers, groups and
// style operations that owns every `GfxPath` it will draw. `evaluate(frame)`
// samples the animated properties and rebuilds the paths whose inputs changed.
// `paintLayer` records one layer's own shapes, text or image into a canvas, and
// `LottieScene` places the layers as nodes.
//
// Shape semantics follow the file format. Items in a group are listed top to
// bottom, so the last item paints first. A fill or stroke applies to every path
// above it in the list, including paths of nested groups, and paints them as one
// compound path so overlaps do not blend twice.

import { GfxPath } from '../../render/gfx/GfxPath'
import { constantProp, createPathData } from '../anim/props'
import type {
  GfxFill,
  GfxGradientStop,
  GfxLinearGradient,
  GfxRadialGradient,
} from '../../render/gfx/Gfx2D'
import type { Canvas } from '../../render/picture/Canvas'
import type {
  LottieAnimation,
  LottieDiagnostic,
  LottieEllipseItem,
  LottieGradient,
  LottieLayer,
  LottieRectItem,
  LottieRepeaterItem,
  LottieShapeItem,
  LottieTextDocument,
  LottieStrokeStyle,
  LottieTransform,
} from '../model/types'
import {
  identity,
  multiply,
  sampleTransform,
  setIdentity,
  type Affine,
} from './affine'
import {
  PathPool,
  appendPathData,
  genEllipse,
  genPath,
  genRect,
  genStar,
  transformPath,
} from './shapes'
import {
  PathSet,
  mergeSet,
  puckerBloatSet,
  roundCornersSet,
  trimSet,
} from './modifiers'

/** Deepest precomposition nesting that is compiled. */
const MAX_PRECOMP_DEPTH = 8

/** Most copies a repeater makes. */
const MAX_COPIES = 1000

const DEG = Math.PI / 180

/** The fill a glyph outline is drawn with, recolored from the text document. */
const GLYPH_FILL: LottieShapeItem = {
  kind: 'fill',
  name: 'glyph fill',
  direction: 1,
  color: constantProp([1, 1, 1, 1]),
  opacity: constantProp([100]),
  rule: 'nonzero',
}

/** Line breaks in a text document: CR, LF, CRLF and the ETX character. */
// eslint-disable-next-line no-control-regex
const LINE_BREAK = /\r\n|\r|\u0003|\n/

const MASK_DATA = createPathData(32)

type GeometryItem = Extract<
  LottieShapeItem,
  { kind: 'path' | 'rect' | 'ellipse' | 'star' }
>
type StyleItem = Extract<
  LottieShapeItem,
  { kind: 'fill' | 'gradient-fill' | 'stroke' | 'gradient-stroke' }
>

/** Modifiers that change the path set. */
type ModItem = Extract<
  LottieShapeItem,
  { kind: 'trim' | 'round-corners' | 'pucker-bloat' | 'merge-paths' }
>

/**
 * One step of a group's path pipeline, in array order. Geometry adds paths, a
 * modifier changes the set so far, and a nested group adds its own result.
 */
type COp =
  | { k: 'geom'; item: GeometryItem; index: number }
  | { k: 'mod'; item: ModItem; index: number }
  | { k: 'group'; group: CGroup; index: number }

/** A repeater with the per-copy values of the current frame. */
interface CRepeater {
  item: LottieRepeaterItem
  /** Position of the repeater in its group's item list. */
  index: number
  copies: number
  /** Copy transforms, 6 floats each. */
  mats: Float64Array
  /** Copy opacities. */
  opac: Float64Array
}

interface CStyle {
  item: StyleItem
  group: CGroup
  /** The group's pipeline up to this style. */
  ops: COp[]
  /** Repeaters of the group that multiply this style's geometry. */
  repeatBy: CRepeater[]
  compound: GfxPath
  /** True when the compound path can never change after the first build. */
  staticGeometry: boolean
  built: boolean
  visible: boolean
  alpha: number
  fill: GfxFill
  linear: GfxLinearGradient | null
  radial: GfxRadialGradient | null
  /** Fill rule forced by a merge, or null. */
  ruleOverride: 'nonzero' | 'evenodd' | null
  /** Color forced by a text layer's own fill or stroke color. */
  colorOverride: string | null
  width: number
  /** Dash pattern and offset, in style space. */
  dash: number[]
  dashOffset: number
  /**
   * The style's only shape when it draws as one analytic instance instead of a
   * path (see `analyticShapeOf`), else null. Set each frame.
   */
  analytic: LottieRectItem | LottieEllipseItem | null
  /** That shape's box at the current frame, center and size, and corner radius. */
  box: { cx: number; cy: number; w: number; h: number; radius: number }
}

type CElement = { style: CStyle } | { group: CGroup }

interface CGroup {
  transform: LottieTransform | null
  /** Local matrix, group space to parent space. */
  mat: Affine
  alpha: number
  elements: CElement[]
  /** The group's pipeline in array order. */
  ops: COp[]
  repeaters: CRepeater[]
  /** Repeaters of the enclosing group that multiply this whole group. */
  repeatBy: CRepeater[]
}

/** One compiled layer. @internal */
export interface CLayer {
  model: LottieLayer
  parent: CLayer | null
  /** Matrix from layer space to the animation's canvas. */
  matrix: Affine
  local: Affine
  alpha: number
  visible: boolean
  /** Increments each evaluation, so a parent matrix is computed once. */
  stamp: number
  root: CGroup | null
  inner: CComp | null
  innerFrame: number
  /** The precomposition's own bounds, which clip its contents. */
  boundsClip: GfxPath | null
  /** A single additive mask, drawn as a clip. */
  maskClip: GfxPath | null
  /** Solid layer fill. */
  solidFill: string | null
  /** Masks drawn through a coverage surface, one path each. */
  maskPaths: GfxPath[]
  /** The layer whose rendering mattes this one, or null. */
  matteSource: CLayer | null
  /** A matte source is only drawn into the layers it mattes. */
  matteOnly: boolean
  /** The layer's blend as an offscreen composite blend, or null. */
  blend: 'multiply' | 'screen' | 'lighter' | null
  /**
   * Drawing styles the layer holds, used to decide whether opacity needs a
   * surface.
   */
  styleCount: number
  /** Text layout, for text layers. */
  text: CText | null
  /** The decoded picture of an image layer, once it has loaded. */
  image: CanvasImageSource | null
  /** Whether this frame draws the layer through a surface. */
  surface: boolean
  /** Opacity applied when the surface composites. */
  surfaceOpacity: number
  /**
   * True when what the layer paints cannot change from one frame to the next.
   * Its matrix may still move, which never repaints it.
   */
  contentStatic: boolean
}

/** One glyph outline compiled for a text layer. */
interface CGlyph {
  group: CGroup
  /** The size the outline is drawn at, and its advance at that size. */
  size: number
  width: number
}

/** A glyph placed by the current text layout. */
interface CPlaced {
  glyph: CGlyph
  x: number
  y: number
  scale: number
}

/** Text layer state: glyph outlines, or lines for the font path. */
interface CText {
  glyphs: Map<string, CGlyph>
  placed: CPlaced[]
  placedCount: number
  /** Lines to draw with the platform font when a character has no outline. */
  lines: Array<{ text: string; x: number; y: number }>
  font: string
  size: number
  align: CanvasTextAlign
  color: string
  doc: LottieTextDocument | null
}

/** The layers of one composition, first in the file on top. @internal */
export interface CComp {
  layers: CLayer[]
}

/** CSS color strings by packed rgb, so a per-frame color allocates nothing. */
const COLOR_STRINGS = new Map<number, string>()

function cssColor(r: number, g: number, b: number): string {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)))
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)))
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)))
  const key = (ri << 16) | (gi << 8) | bi
  let s = COLOR_STRINGS.get(key)
  if (s === undefined) {
    s = `rgb(${ri}, ${gi}, ${bi})`
    COLOR_STRINGS.set(key, s)
  }
  return s
}

const COLOR4 = new Float64Array(4)
const POINT = new Float64Array(2)

function propsOfGeometry(item: GeometryItem): Array<{ isStatic: boolean }> {
  switch (item.kind) {
    case 'path':
      return [item.path]
    case 'rect':
      return [item.position, item.size, item.roundness]
    case 'ellipse':
      return [item.position, item.size]
    case 'star': {
      const list: Array<{ isStatic: boolean }> = [
        item.position,
        item.points,
        item.rotation,
        item.outerRadius,
      ]
      if (item.innerRadius) list.push(item.innerRadius)
      return list
    }
  }
}

function transformIsStatic(t: LottieTransform | null): boolean {
  if (!t) return true
  return [
    t.anchor,
    t.position,
    t.positionX,
    t.positionY,
    t.scale,
    t.rotation,
    t.skew,
    t.skewAxis,
  ].every((p) => !p || p.isStatic)
}

/** Force the color of every fill (and stroke) in a glyph's shapes. */
function setOverrides(
  group: CGroup,
  fill: string | null,
  stroke: string | null,
): void {
  for (const el of group.elements) {
    if ('group' in el) {
      setOverrides(el.group, fill, stroke)
    } else {
      const kind = el.style.item.kind
      el.style.colorOverride =
        kind === 'fill' ? fill : kind === 'stroke' ? stroke : null
    }
  }
}

/** Number of style draws in a group tree. */
function countStyles(group: CGroup): number {
  let n = 0
  for (const el of group.elements) {
    n += 'group' in el ? countStyles(el.group) : 1
  }
  return n
}

/**
 * Append `mods` to the pipeline of every style in `group`, nested groups
 * included.
 */
function inheritMods(group: CGroup, mods: COp[]): void {
  for (const el of group.elements) {
    if ('group' in el) {
      inheritMods(el.group, mods)
    } else {
      el.style.ops.push(...mods)
      el.style.staticGeometry = opsAreStatic(el.style.ops)
    }
  }
}

function propsOfMod(item: ModItem): Array<{ isStatic: boolean }> {
  switch (item.kind) {
    case 'trim':
      return [item.start, item.end, item.offset]
    case 'round-corners':
      return [item.radius]
    case 'pucker-bloat':
      return [item.amount]
    case 'merge-paths':
      return []
  }
}

/** True when nothing in the pipeline can change from one frame to the next. */
/**
 * The shape a style draws as one analytic instance instead of a path, or null.
 * That needs the style to cover exactly one rect or ellipse with nothing
 * changing it. A Lottie fill covers every shape before it in its group as one
 * path under one winding rule, so two shapes, which may overlap or cut holes,
 * keep the path route. So do the paints and strokes the shape program can't
 * draw: a radial gradient, a gradient stroke, a dash, and a sharp rect corner
 * stroked with a join other than round, since a band around a sharp corner
 * comes out round.
 */
function analyticShapeOf(
  style: CStyle,
): LottieRectItem | LottieEllipseItem | null {
  if (style.ops.length !== 1) return null
  const op = style.ops[0]
  if (op.k !== 'geom') return null
  const shape = op.item
  if (shape.kind !== 'rect' && shape.kind !== 'ellipse') return null
  if (style.radial) return null
  const item = style.item
  if (item.kind === 'gradient-stroke') return null
  if (item.kind === 'stroke') {
    if (item.dashes.length > 0) return null
    if (shape.kind === 'rect' && item.join !== 'round') {
      const rounded = shape.roundness.isStatic && shape.roundness.get(0) > 0
      if (!rounded) return null
    }
  }
  return shape
}

/** `shape`'s center, size and corner radius at `frame`, written into `out`. */
function sampleBox(
  shape: LottieRectItem | LottieEllipseItem,
  frame: number,
  out: CStyle['box'],
): void {
  shape.position.sample(frame, POINT)
  out.cx = POINT[0]
  out.cy = POINT[1]
  shape.size.sample(frame, POINT)
  out.w = POINT[0]
  out.h = POINT[1]
  // As `genRect` does, a roundness past half the shorter side is capped there.
  out.radius =
    shape.kind === 'rect'
      ? Math.max(0, Math.min(shape.roundness.get(frame), out.w / 2, out.h / 2))
      : 0
}

function opsAreStatic(ops: COp[]): boolean {
  for (const op of ops) {
    switch (op.k) {
      case 'geom':
        if (!propsOfGeometry(op.item).every((p) => p.isStatic)) return false
        break
      case 'mod':
        if (!propsOfMod(op.item).every((p) => p.isStatic)) return false
        break
      case 'group':
        if (!transformIsStatic(op.group.transform)) return false
        if (!opsAreStatic(op.group.ops)) return false
        break
    }
  }
  return true
}

type StaticProp = { isStatic: boolean } | null | undefined

function propsStatic(...props: StaticProp[]): boolean {
  return props.every((p) => !p || p.isStatic)
}

function repeaterIsStatic(rep: CRepeater): boolean {
  const it = rep.item
  const t = it.transform
  return propsStatic(
    it.copies,
    it.offset,
    t.anchor,
    t.position,
    t.scale,
    t.rotation,
    t.startOpacity,
    t.endOpacity,
  )
}

function gradientIsStatic(item: {
  start: StaticProp
  end: StaticProp
  highlightLength: StaticProp
  highlightAngle: StaticProp
  gradient: { data: StaticProp }
}): boolean {
  return propsStatic(
    item.start,
    item.end,
    item.highlightLength,
    item.highlightAngle,
    item.gradient.data,
  )
}

function styleIsStatic(style: CStyle): boolean {
  const item = style.item
  if (!style.staticGeometry || !item.opacity.isStatic) return false
  if (!style.repeatBy.every(repeaterIsStatic)) return false
  switch (item.kind) {
    case 'fill':
      return item.color.isStatic
    case 'stroke':
      return (
        propsStatic(item.color, item.width) &&
        item.dashes.every((d) => d.value.isStatic)
      )
    case 'gradient-fill':
      return gradientIsStatic(item)
    case 'gradient-stroke':
      return (
        gradientIsStatic(item) &&
        propsStatic(item.width) &&
        item.dashes.every((d) => d.value.isStatic)
      )
  }
}

/** True when nothing a group paints can change from one frame to the next. */
function groupIsStatic(group: CGroup): boolean {
  if (!transformIsStatic(group.transform)) return false
  if (group.transform && !group.transform.opacity.isStatic) return false
  if (!group.repeaters.every(repeaterIsStatic)) return false
  return group.elements.every((el) =>
    'group' in el ? groupIsStatic(el.group) : styleIsStatic(el.style),
  )
}

/**
 * Compiles and evaluates one animation. A renderer holds mutable per-frame
 * state, so each node owns its own.
 *
 * @internal
 */
export class LottieRenderer {
  /** Features the animation uses that this renderer does not draw. */
  readonly diagnostics: LottieDiagnostic[] = []

  readonly #anim: LottieAnimation
  readonly #root: CComp
  #stamp = 0
  readonly #reported = new Set<string>()
  readonly #base = identity()
  readonly #identity = identity()
  readonly #pool = new PathPool()
  readonly #sets: PathSet[] = []
  readonly #modOut = new PathSet()

  readonly #exactOpacity: boolean
  readonly #imageLayers: CLayer[] = []

  constructor(anim: LottieAnimation, opts: { exactOpacity?: boolean } = {}) {
    this.#anim = anim
    this.#exactOpacity = opts.exactOpacity ?? true
    this.#root = this.#compileComp(anim.layers, 0)
    this.#markStatic(this.#root, true)
  }

  /**
   * Work out which layers paint the same thing every frame. A layer's opacity
   * folds into what it paints, so an animated one makes the content of the
   * layer and of everything inside a precomposition move too.
   */
  #markStatic(comp: CComp, inherited: boolean): void {
    for (const layer of comp.layers) {
      const opacityStatic = layer.model.transform.opacity.isStatic
      layer.contentStatic =
        inherited &&
        opacityStatic &&
        (layer.model.type === 'shape'
          ? layer.root !== null && groupIsStatic(layer.root)
          : layer.model.type !== 'text')
      if (layer.inner) this.#markStatic(layer.inner, inherited && opacityStatic)
    }
  }

  /**
   * Sample every animated property at `frame` (in the animation's own frames,
   * including the in point) and rebuild what changed.
   */
  evaluate(frame: number): void {
    setIdentity(this.#base)
    this.#evalComp(this.#root, frame, this.#base, 1)
  }

  /** The compiled layers of the animation's own composition. */
  get comp(): CComp {
    return this.#root
  }

  /**
   * Forget cached geometry. Call after a slot or theme replaced properties, so
   * paths that were static are rebuilt from the new values.
   */
  invalidate(): void {
    const walkGroup = (g: CGroup): void => {
      for (const el of g.elements) {
        if ('group' in el) walkGroup(el.group)
        else {
          el.style.built = false
          el.style.staticGeometry = opsAreStatic(el.style.ops)
        }
      }
    }
    const walkComp = (c: CComp): void => {
      for (const l of c.layers) {
        if (l.root) walkGroup(l.root)
        if (l.inner) walkComp(l.inner)
      }
    }
    walkComp(this.#root)
  }

  /**
   * The image layers that still wait for a picture, as `[asset id, asset]`
   * pairs. Hand each decoded picture to {@link LottieRenderer.setImage}.
   */
  pendingImages(): Array<{
    id: string
    path: string
    dir: string
    embedded: boolean
  }> {
    const out = new Map<
      string,
      { id: string; path: string; dir: string; embedded: boolean }
    >()
    for (const layer of this.#imageLayers) {
      if (layer.image || layer.model.type !== 'image') continue
      const info = this.#anim.assets.get(layer.model.refId)?.image
      if (info) {
        out.set(layer.model.refId, {
          id: layer.model.refId,
          path: info.path,
          dir: info.dir,
          embedded: info.embedded,
        })
      }
    }
    return [...out.values()]
  }

  /** Give every image layer that uses asset `id` its picture. */
  setImage(id: string, image: CanvasImageSource): void {
    for (const layer of this.#imageLayers) {
      if (layer.model.type === 'image' && layer.model.refId === id) {
        layer.image = image
      }
    }
  }

  /** Release every path the renderer owns. Drawing afterwards draws nothing. */
  dispose(): void {
    const walkGroup = (g: CGroup): void => {
      for (const el of g.elements) {
        if ('group' in el) walkGroup(el.group)
        else el.style.compound.release()
      }
    }
    const walkComp = (c: CComp): void => {
      for (const l of c.layers) {
        if (l.root) walkGroup(l.root)
        l.boundsClip?.release()
        l.maskClip?.release()
        if (l.inner) walkComp(l.inner)
      }
    }
    walkComp(this.#root)
  }

  // --- compile ---------------------------------------------------------------

  #note(code: string, message: string, layer: string): void {
    const key = `${code}|${layer}`
    if (this.#reported.has(key)) return
    this.#reported.add(key)
    this.diagnostics.push({ code, message, layer })
  }

  #compileComp(layers: readonly LottieLayer[], depth: number): CComp {
    const out: CLayer[] = []
    const byIndex = new Map<number, CLayer>()
    for (const model of layers) {
      const layer: CLayer = {
        model,
        parent: null,
        matrix: identity(),
        local: identity(),
        alpha: 1,
        visible: false,
        stamp: -1,
        root: null,
        inner: null,
        innerFrame: 0,
        boundsClip: null,
        maskClip: null,
        solidFill: null,
        maskPaths: [],
        matteSource: null,
        matteOnly: false,
        blend: null,
        styleCount: 1,
        text: null,
        image: null,
        surface: false,
        surfaceOpacity: 1,
        contentStatic: false,
      }
      byIndex.set(model.index, layer)
      out.push(layer)
      this.#compileLayer(layer, depth)
    }
    for (let i = 0; i < out.length; i++) {
      const layer = out[i]
      const p = layer.model.parent
      if (p >= 0 && p !== layer.model.index)
        layer.parent = byIndex.get(p) ?? null
      if (layer.model.matteMode !== 'none') {
        // The source is named by `tp`, or is the layer listed just above.
        const named = layer.model.matteSource
        layer.matteSource =
          named >= 0 ? (byIndex.get(named) ?? null) : (out[i - 1] ?? null)
        if (layer.matteSource) layer.matteSource.matteOnly = true
      }
    }
    return { layers: out }
  }

  #compileLayer(layer: CLayer, depth: number): void {
    const m = layer.model
    if (m.masks.length > 0) {
      const only = m.masks.length === 1 ? m.masks[0] : null
      if (
        only &&
        only.mode === 'add' &&
        !only.inverted &&
        only.opacity.isStatic &&
        only.opacity.get(0) >= 100 &&
        only.expansion.isStatic &&
        only.expansion.get(0) === 0
      ) {
        layer.maskClip = new GfxPath()
      } else {
        for (const mask of m.masks) {
          if (mask.mode === 'none') continue
          layer.maskPaths.push(new GfxPath())
        }
        if (
          m.masks.some((x) => !x.expansion.isStatic || x.expansion.get(0) !== 0)
        ) {
          this.#note(
            'unsupported-mask-expansion',
            'Mask expansion is not applied.',
            m.name,
          )
        }
      }
    }
    if (m.blendMode) {
      if (
        m.blendMode === 'multiply' ||
        m.blendMode === 'screen' ||
        m.blendMode === 'lighter'
      ) {
        layer.blend = m.blendMode
      } else {
        this.#note(
          'unsupported-blend',
          `Blend mode '${m.blendMode}' draws as normal.`,
          m.name,
        )
      }
    }
    if (m.autoOrient) {
      this.#note(
        'unsupported-auto-orient',
        'Auto-orient is not applied.',
        m.name,
      )
    }
    switch (m.type) {
      case 'shape':
        layer.root = this.#compileGroup(m.shapes, null, m.name)
        layer.styleCount = countStyles(layer.root)
        break
      case 'solid':
        break
      case 'precomp': {
        const asset = this.#anim.assets.get(m.refId)
        if (asset?.layers && depth < MAX_PRECOMP_DEPTH) {
          layer.inner = this.#compileComp(asset.layers, depth + 1)
          layer.styleCount = 2
          if (m.width > 0 && m.height > 0) {
            layer.boundsClip = new GfxPath()
              .moveTo(0, 0)
              .lineTo(m.width, 0)
              .lineTo(m.width, m.height)
              .lineTo(0, m.height)
              .close()
          }
        }
        break
      }
      case 'text': {
        if (m.animators > 0) {
          this.#note(
            'unsupported-text-animators',
            'Text animators are not applied.',
            m.name,
          )
        }
        const glyphs = new Map<string, CGlyph>()
        for (const g of this.#anim.glyphs) {
          glyphs.set(`${g.family}|${g.style}|${g.char}`, {
            // Outlines carry no fill. The document's color is the fill of
            // everything above this item.
            group: this.#compileGroup([...g.shapes, GLYPH_FILL], null, m.name),
            size: g.size || 100,
            width: g.width,
          })
        }
        layer.text = {
          glyphs,
          placed: [],
          placedCount: 0,
          lines: [],
          font: '',
          size: 0,
          align: 'left',
          color: '#000000',
          doc: null,
        }
        break
      }
      case 'image':
        this.#imageLayers.push(layer)
        break
      default:
        break
    }
  }

  #compileGroup(
    items: readonly LottieShapeItem[],
    _parent: CGroup | null,
    layerName: string,
  ): CGroup {
    const group: CGroup = {
      transform: null,
      mat: identity(),
      alpha: 1,
      elements: [],
      ops: [],
      repeaters: [],
      repeatBy: [],
    }
    const styles: CStyle[] = []
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      switch (item.kind) {
        case 'transform':
          group.transform = item.transform
          break
        case 'path':
        case 'rect':
        case 'ellipse':
        case 'star':
          group.ops.push({ k: 'geom', item, index })
          break
        case 'trim':
        case 'round-corners':
        case 'pucker-bloat':
          group.ops.push({ k: 'mod', item, index })
          break
        case 'merge-paths':
          group.ops.push({ k: 'mod', item, index })
          break
        case 'repeater':
          group.repeaters.push({
            item,
            index,
            copies: 0,
            mats: new Float64Array(6),
            opac: new Float64Array(1),
          })
          break
        case 'group': {
          const child = this.#compileGroup(item.items, group, layerName)
          group.ops.push({ k: 'group', group: child, index })
          group.elements.push({ group: child })
          break
        }
        case 'fill':
        case 'gradient-fill':
        case 'stroke':
        case 'gradient-stroke': {
          const style: CStyle = {
            item,
            group,
            ops: group.ops.slice(),
            repeatBy: [],
            compound: new GfxPath(),
            staticGeometry: false,
            built: false,
            visible: true,
            alpha: 1,
            fill: '#000000',
            linear: null,
            radial: null,
            ruleOverride: null,
            colorOverride: null,
            width: 0,
            dash: [],
            dashOffset: 0,
            analytic: null,
            box: { cx: 0, cy: 0, w: 0, h: 0, radius: 0 },
          }
          style.staticGeometry = opsAreStatic(style.ops)
          if (
            item.kind === 'gradient-fill' ||
            item.kind === 'gradient-stroke'
          ) {
            if (item.gradientType === 2) {
              style.radial = {
                kind: 'radial',
                cx: 0,
                cy: 0,
                r: 0,
                fx: 0,
                fy: 0,
                stops: [],
              }
            } else {
              style.linear = {
                kind: 'linear',
                x0: 0,
                y0: 0,
                x1: 0,
                y1: 0,
                stops: [],
              }
            }
          }
          styles.push(style)
          group.elements.push({ style })
          break
        }
        default:
          this.#note(
            `unsupported-${item.kind}`,
            `The '${item.kind}' modifier is not applied yet.`,
            layerName,
          )
          break
      }
    }
    // A repeater multiplies the styles and groups whose geometry comes before
    // it in the list.
    for (const style of styles) {
      let first = Infinity
      for (const op of style.ops) first = Math.min(first, op.index)
      for (const rep of group.repeaters) {
        if (first < rep.index) style.repeatBy.push(rep)
      }
    }
    for (const el of group.elements) {
      if (!('group' in el)) continue
      const op = group.ops.find((o) => o.k === 'group' && o.group === el.group)
      if (!op) continue
      for (const rep of group.repeaters) {
        if (op.index < rep.index) el.group.repeatBy.push(rep)
      }
    }
    // A modifier also shapes the paths of groups listed above it, including the
    // ones their own styles draw.
    for (const op of group.ops) {
      if (op.k !== 'group') continue
      const later = group.ops.filter((o) => o.k === 'mod' && o.index > op.index)
      if (later.length > 0) inheritMods(op.group, later)
    }
    // The last item paints first.
    group.elements.reverse()
    return group
  }

  // --- evaluate --------------------------------------------------------------

  #evalComp(comp: CComp, frame: number, base: Affine, baseAlpha: number): void {
    const stamp = ++this.#stamp
    for (const layer of comp.layers) {
      const m = layer.model
      // A matte source is drawn into the layers it mattes even when hidden.
      layer.visible =
        (!m.hidden || layer.matteOnly) &&
        frame >= m.inPoint &&
        frame < m.outPoint
      if (!layer.visible && !this.#isParent(comp, layer)) {
        layer.alpha = 0
        continue
      }
      // A parent listed after its child was already computed through the
      // child, so its opacity must not be reset here.
      this.#layerMatrix(layer, frame, base, stamp)
    }
    for (const layer of comp.layers) {
      if (!layer.visible) continue
      const m = layer.model
      // `layer.alpha` holds the layer's own opacity until it is combined here.
      const own = baseAlpha * layer.alpha
      if (own <= 0) {
        layer.visible = false
        continue
      }
      // Opacity that must apply to the layer as a whole goes on a surface,
      // everything else folds into the draws.
      layer.surface =
        !layer.matteOnly &&
        (layer.matteSource !== null ||
          layer.maskPaths.length > 0 ||
          layer.blend !== null ||
          (this.#exactOpacity && layer.styleCount > 1 && layer.alpha < 0.999))
      const alpha = layer.surface ? 1 : own
      layer.surfaceOpacity = layer.surface ? own : 1
      layer.alpha = alpha
      if (layer.maskClip) this.#evalMask(layer, frame)
      if (layer.maskPaths.length > 0) this.#evalMasks(layer, frame)
      switch (m.type) {
        case 'solid':
          layer.solidFill = parseSolidColor(m.color)
          break
        case 'shape':
          if (layer.root) this.#evalGroup(layer.root, frame, alpha)
          break
        case 'text':
          this.#evalText(layer, frame, alpha)
          break
        case 'precomp': {
          if (!layer.inner) break
          let inner: number
          if (m.timeRemap) inner = m.timeRemap.get(frame) * this.#anim.frameRate
          else inner = (frame - m.startTime) / m.stretch
          layer.innerFrame = inner
          this.#evalComp(layer.inner, inner, this.#identity, alpha)
          break
        }
        default:
          break
      }
    }
  }

  /** Lay out a text layer's document at `frame`. */
  #evalText(layer: CLayer, frame: number, alpha: number): void {
    const text = layer.text
    const m = layer.model
    if (!text || m.type !== 'text' || m.documents.length === 0) return
    let doc = m.documents[0]
    for (const d of m.documents) {
      if (d.frame <= frame) doc = d
      else break
    }
    text.doc = doc
    text.placedCount = 0
    text.lines.length = 0
    text.size = doc.size
    text.color = doc.fill
      ? cssColor(doc.fill[0], doc.fill[1], doc.fill[2])
      : '#000000'
    text.align =
      doc.justify === 1 ? 'right' : doc.justify === 2 ? 'center' : 'left'
    const font = this.#anim.fonts.find((f) => f.name === doc.font)
    const family = font?.family ?? ''
    const style = font?.style ?? ''
    text.font = `${doc.size}px "${family || doc.font}", sans-serif`
    const fill = doc.fill ? text.color : null
    const stroke = doc.stroke
      ? cssColor(doc.stroke[0], doc.stroke[1], doc.stroke[2])
      : null
    const lines = doc.text.split(LINE_BREAK)
    const used = new Set<CGlyph>()
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const y = li * doc.lineHeight
      // Measure first, so justification can place the line.
      let width = 0
      let missing = false
      const found: Array<CGlyph | null> = []
      for (const ch of line) {
        const g = text.glyphs.get(`${family}|${style}|${ch}`) ?? null
        if (!g) missing = true
        found.push(g)
        width += g ? (g.width * doc.size) / g.size : doc.size * 0.5
        width += (doc.tracking * doc.size) / 1000
      }
      const startX =
        doc.justify === 1 ? -width : doc.justify === 2 ? -width / 2 : 0
      if (missing || text.glyphs.size === 0) {
        text.lines.push({ text: line, x: 0, y })
        continue
      }
      let x = startX
      for (const g of found) {
        if (g) {
          const scale = doc.size / g.size
          let p = text.placed[text.placedCount]
          if (!p)
            text.placed[text.placedCount] = p = {
              glyph: g,
              x: 0,
              y: 0,
              scale: 1,
            }
          p.glyph = g
          p.x = x
          p.y = y
          p.scale = scale
          text.placedCount++
          used.add(g)
          x += g.width * scale
        } else x += doc.size * 0.5
        x += (doc.tracking * doc.size) / 1000
      }
    }
    // The document's colors replace the glyphs' own, then each outline is
    // evaluated once for all the places it is drawn.
    for (const g of used) {
      setOverrides(g.group, fill, stroke)
      this.#evalGroup(g.group, frame, alpha)
    }
  }

  /** Rebuild the paths of the masks drawn through a coverage surface. */
  #evalMasks(layer: CLayer, frame: number): void {
    let k = 0
    for (const mask of layer.model.masks) {
      if (mask.mode === 'none') continue
      const path = layer.maskPaths[k++]
      if (mask.path.isStatic && path.version > 0 && !path.isEmpty) continue
      mask.path.sample(frame, MASK_DATA)
      path.clear()
      appendPathData(path, MASK_DATA)
    }
  }

  /** Rebuild the single mask's clip path. */
  #evalMask(layer: CLayer, frame: number): void {
    const clip = layer.maskClip
    const mask = layer.model.masks[0]
    if (!clip || !mask) return
    if (mask.path.isStatic && clip.version > 0 && !clip.isEmpty) return
    mask.path.sample(frame, MASK_DATA)
    clip.clear()
    appendPathData(clip, MASK_DATA)
  }

  #isParent(comp: CComp, layer: CLayer): boolean {
    for (const other of comp.layers) {
      if (other.parent === layer) return true
    }
    return false
  }

  /** The layer's matrix and opacity at `frame`, parents first, computed once. */
  #layerMatrix(
    layer: CLayer,
    frame: number,
    base: Affine,
    stamp: number,
  ): void {
    if (layer.stamp === stamp) return
    layer.stamp = stamp
    const o = sampleTransform(layer.model.transform, frame, layer.local)
    layer.alpha = o
    if (layer.parent) {
      this.#layerMatrix(layer.parent, frame, base, stamp)
      multiply(layer.matrix, layer.parent.matrix, layer.local)
    } else {
      multiply(layer.matrix, base, layer.local)
    }
  }

  #evalGroup(group: CGroup, frame: number, parentAlpha: number): void {
    let alpha = parentAlpha
    if (group.transform) {
      alpha *= sampleTransform(group.transform, frame, group.mat)
    } else {
      setIdentity(group.mat)
    }
    group.alpha = alpha
    for (const rep of group.repeaters) this.#evalRepeater(rep, frame)
    for (const el of group.elements) {
      if ('group' in el) this.#evalGroup(el.group, frame, alpha)
      else this.#evalStyle(el.style, frame, alpha)
    }
  }

  /**
   * Compute the transform and opacity of every copy. Copy `i` moves by `offset
   *
   * - I` steps of the repeater's transform, and its opacity runs from the start
   *   to the end value across the copies.
   */
  #evalRepeater(rep: CRepeater, frame: number): void {
    const it = rep.item
    const n = Math.max(
      0,
      Math.min(MAX_COPIES, Math.round(it.copies.get(frame))),
    )
    rep.copies = n
    if (rep.mats.length < n * 6) {
      rep.mats = new Float64Array(n * 6)
      rep.opac = new Float64Array(n)
    }
    const t = it.transform
    t.anchor.sample(frame, POINT)
    const ax = POINT[0]
    const ay = POINT[1]
    t.position.sample(frame, POINT)
    const px = POINT[0]
    const py = POINT[1]
    t.scale.sample(frame, POINT)
    const sx = POINT[0] / 100
    const sy = POINT[1] / 100
    const rot = t.rotation.get(frame)
    const so = t.startOpacity.get(frame) / 100
    const eo = t.endOpacity.get(frame) / 100
    const offset = it.offset.get(frame)
    for (let i = 0; i < n; i++) {
      const k = offset + i
      const a = rot * k * DEG
      const cs = Math.cos(a)
      const sn = Math.sin(a)
      const scx = Math.pow(sx, k)
      const scy = Math.pow(sy, k)
      const m = rep.mats
      const o = i * 6
      // T(pos*k + anchor) · R · S · T(-anchor)
      const ma = cs * scx
      const mb = sn * scx
      const mc = -sn * scy
      const md = cs * scy
      m[o] = ma
      m[o + 1] = mb
      m[o + 2] = mc
      m[o + 3] = md
      m[o + 4] = px * k + ax - (ma * ax + mc * ay)
      m[o + 5] = py * k + ay - (mb * ax + md * ay)
      rep.opac[i] = n > 1 ? so + ((eo - so) * i) / (n - 1) : so
    }
  }

  #evalStyle(style: CStyle, frame: number, groupAlpha: number): void {
    const item = style.item
    const opacity = item.opacity.get(frame) / 100
    style.alpha = groupAlpha * Math.max(0, Math.min(1, opacity))
    style.visible = style.alpha > 0 && style.ops.length > 0
    if (!style.visible) return

    style.analytic = analyticShapeOf(style)
    if (style.analytic) {
      sampleBox(style.analytic, frame, style.box)
    } else if (!(style.staticGeometry && style.built)) {
      this.#buildCompound(style, frame)
      style.built = true
    }

    switch (item.kind) {
      case 'fill':
        item.color.sample(frame, COLOR4)
        style.fill =
          style.colorOverride ?? cssColor(COLOR4[0], COLOR4[1], COLOR4[2])
        break
      case 'stroke':
        item.color.sample(frame, COLOR4)
        style.fill =
          style.colorOverride ?? cssColor(COLOR4[0], COLOR4[1], COLOR4[2])
        this.#evalStroke(style, item, frame)
        break
      case 'gradient-fill':
      case 'gradient-stroke': {
        item.start.sample(frame, POINT)
        const sx = POINT[0]
        const sy = POINT[1]
        item.end.sample(frame, POINT)
        const ex = POINT[0]
        const ey = POINT[1]
        const stops = gradientStops(item.gradient, frame)
        const radial = style.radial
        if (radial) {
          const r = Math.hypot(ex - sx, ey - sy)
          radial.cx = sx
          radial.cy = sy
          radial.r = r
          let fx = sx
          let fy = sy
          if (item.highlightLength) {
            const h = Math.max(
              -0.99,
              Math.min(0.99, item.highlightLength.get(frame) / 100),
            )
            const angle =
              Math.atan2(ey - sy, ex - sx) +
              (item.highlightAngle
                ? (item.highlightAngle.get(frame) * Math.PI) / 180
                : 0)
            fx = sx + Math.cos(angle) * h * r
            fy = sy + Math.sin(angle) * h * r
          }
          radial.fx = fx
          radial.fy = fy
          radial.stops = stops
          style.fill = radial
        } else if (style.linear) {
          const g = style.linear
          g.x0 = sx
          g.y0 = sy
          g.x1 = ex
          g.y1 = ey
          g.stops = stops
          style.fill = g
        }
        if (item.kind === 'gradient-stroke')
          this.#evalStroke(style, item, frame)
        break
      }
    }
  }

  /** Width and dash pattern of a stroke at `frame`. */
  #evalStroke(style: CStyle, item: LottieStrokeStyle, frame: number): void {
    style.width = item.width.get(frame)
    const dash = style.dash
    dash.length = 0
    style.dashOffset = 0
    if (item.dashes.length === 0) return
    let dashes = 0
    let gaps = 0
    for (const d of item.dashes) {
      if (d.kind === 'o') {
        style.dashOffset = d.value.get(frame)
      } else {
        dash.push(d.value.get(frame))
        if (d.kind === 'd') dashes++
        else gaps++
      }
    }
    // A pattern of dashes with no gaps leaves a gap as long as each dash.
    if (gaps === 0 && dashes > 0) {
      const n = dash.length
      for (let i = 0; i < n; i++) dash.push(dash[i])
    }
  }

  #buildCompound(style: CStyle, frame: number): void {
    const path = style.compound
    path.clear()
    this.#pool.reset()
    const set = this.#set(0)
    set.clear()
    this.#evalOps(style.ops, frame, set, 1)
    for (let i = 0; i < set.count; i++) appendPathData(path, set.items[i])
    style.ruleOverride = set.rule
  }

  /** The reusable path set for recursion `depth`. */
  #set(depth: number): PathSet {
    let s = this.#sets[depth]
    if (!s) {
      s = new PathSet()
      this.#sets[depth] = s
    }
    return s
  }

  /** Run a group's pipeline at `frame`, leaving the resulting paths in `set`. */
  #evalOps(ops: COp[], frame: number, set: PathSet, depth: number): void {
    const pool = this.#pool
    for (const op of ops) {
      switch (op.k) {
        case 'geom': {
          const item = op.item
          let p
          switch (item.kind) {
            case 'path':
              p = genPath(pool, item, frame)
              break
            case 'rect':
              p = genRect(pool, item, frame)
              break
            case 'ellipse':
              p = genEllipse(pool, item, frame)
              break
            case 'star':
              p = genStar(pool, item, frame)
              break
          }
          if (p && p.count > 0) set.push(p)
          break
        }
        case 'mod':
          this.#applyMod(op.item, frame, set)
          break
        case 'group': {
          const g = op.group
          if (g.transform) sampleTransform(g.transform, frame, g.mat)
          else setIdentity(g.mat)
          const sub = this.#set(depth)
          sub.clear()
          this.#evalOps(g.ops, frame, sub, depth + 1)
          for (let i = 0; i < sub.count; i++) {
            transformPath(sub.items[i], g.mat)
            set.push(sub.items[i])
          }
          if (sub.rule) set.rule = sub.rule
          break
        }
      }
    }
  }

  #applyMod(item: ModItem, frame: number, set: PathSet): void {
    const out = this.#modOut
    switch (item.kind) {
      case 'trim':
        trimSet(
          set,
          out,
          this.#pool,
          item.start.get(frame) / 100,
          item.end.get(frame) / 100,
          item.offset.get(frame) / 360,
          item.multiple === 2,
        )
        break
      case 'round-corners':
        roundCornersSet(set, out, this.#pool, item.radius.get(frame))
        break
      case 'pucker-bloat':
        puckerBloatSet(set, out, this.#pool, item.amount.get(frame) / 100)
        break
      case 'merge-paths':
        if (!mergeSet(set, item.mode)) {
          this.#note(
            'unsupported-merge-mode',
            'Merge paths subtract and intersect of several shapes are not applied.',
            '',
          )
        }
        return
    }
    const rule = set.rule
    const merged = set.merged
    set.clear()
    set.rule = rule
    set.merged = merged
    for (let i = 0; i < out.count; i++) set.push(out.items[i])
  }

  // --- paint -----------------------------------------------------------------

  /**
   * Record the layer's own content into `canvas`: a solid, its shapes, its text
   * or its image. A precomposition's content is its inner layers, which are
   * nodes of their own. Opacity that folds into the drawings is applied here,
   * and a layer drawn as a group is composited with its own.
   */
  paintLayer(layer: CLayer, canvas: PaintTarget): void {
    const m = layer.model
    switch (m.type) {
      case 'solid':
        if (layer.solidFill) {
          canvas.setAlpha(layer.alpha)
          canvas.fillRect(0, 0, m.width, m.height, layer.solidFill)
        }
        break
      case 'shape':
        if (layer.root) this.#drawGroup(layer.root, canvas, 1)
        break
      case 'text':
        if (layer.text) this.#drawText(layer.text, canvas, 1, layer.alpha)
        break
      case 'image':
        if (layer.image) {
          const info = this.#anim.assets.get(m.refId)?.image
          if (info) {
            canvas.setAlpha(layer.alpha)
            canvas.drawImage(layer.image, 0, 0, info.width, info.height)
          }
        }
        break
      default:
        break
    }
  }

  #drawText(
    text: CText,
    gfx: PaintTarget,
    alpha: number,
    layerAlpha: number,
  ): void {
    for (let i = 0; i < text.placedCount; i++) {
      const p = text.placed[i]
      gfx.save()
      gfx.translate(p.x, p.y)
      gfx.scale(p.scale, p.scale)
      this.#drawGroup(p.glyph.group, gfx, alpha)
      gfx.restore()
    }
    if (text.lines.length > 0) {
      gfx.setAlpha(alpha * layerAlpha)
      for (const line of text.lines) {
        gfx.fillText(line.text, line.x, line.y, {
          font: text.font,
          align: text.align,
          baseline: 'alphabetic',
          color: text.color,
        })
      }
    }
  }

  #drawGroup(group: CGroup, gfx: PaintTarget, alpha: number): void {
    gfx.save()
    gfx.transform(
      group.mat[0],
      group.mat[1],
      group.mat[2],
      group.mat[3],
      group.mat[4],
      group.mat[5],
    )
    for (const el of group.elements) {
      if ('group' in el) {
        this.#repeat(el.group.repeatBy, 0, gfx, alpha, (a) =>
          this.#drawGroup(el.group, gfx, a),
        )
      } else if (el.style.visible) {
        const style = el.style
        this.#repeat(style.repeatBy, 0, gfx, alpha, (a) =>
          this.#drawStyle(style, gfx, a),
        )
      }
    }
    gfx.restore()
  }

  /**
   * Call `draw` once, or once per copy of each repeater in `reps`, with the
   * copy transform applied and the copy's opacity folded into `alpha`. Copies
   * stack above the original in order, or below it for composite 2.
   */
  #repeat(
    reps: CRepeater[],
    at: number,
    gfx: PaintTarget,
    alpha: number,
    draw: (alpha: number) => void,
  ): void {
    if (at >= reps.length) {
      draw(alpha)
      return
    }
    const rep = reps[at]
    const n = rep.copies
    const below = rep.item.composite === 2
    for (let c = 0; c < n; c++) {
      const i = below ? n - 1 - c : c
      const o = i * 6
      const m = rep.mats
      gfx.save()
      gfx.transform(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5])
      this.#repeat(reps, at + 1, gfx, alpha * rep.opac[i], draw)
      gfx.restore()
    }
  }

  #drawStyle(style: CStyle, gfx: PaintTarget, alpha: number): void {
    gfx.setAlpha(alpha * style.alpha)
    const item = style.item
    const filled = item.kind === 'fill' || item.kind === 'gradient-fill'
    const shape = style.analytic
    if (shape) {
      const { cx, cy, w, h, radius } = style.box
      if (shape.kind === 'ellipse') {
        if (filled) gfx.fillEllipse(cx, cy, w / 2, h / 2, style.fill)
        else gfx.strokeEllipse(cx, cy, w / 2, h / 2, strokeStyleOf(style, item))
      } else if (filled) {
        gfx.fillRoundRect(cx - w / 2, cy - h / 2, w, h, radius, style.fill)
      } else {
        gfx.strokeRoundRect(
          cx - w / 2,
          cy - h / 2,
          w,
          h,
          radius,
          strokeStyleOf(style, item),
        )
      }
      return
    }
    if (filled) {
      gfx.fillPath(style.compound, style.fill, style.ruleOverride ?? item.rule)
    } else {
      gfx.strokePath(style.compound, strokeStyleOf(style, item))
    }
  }
}

/** The calls a layer's content is recorded with. */
export type PaintTarget = Pick<
  Canvas,
  | 'save'
  | 'restore'
  | 'transform'
  | 'translate'
  | 'scale'
  | 'setAlpha'
  | 'fillRect'
  | 'fillRoundRect'
  | 'strokeRoundRect'
  | 'fillEllipse'
  | 'strokeEllipse'
  | 'fillPath'
  | 'strokePath'
  | 'fillText'
  | 'drawImage'
>

const STROKE_SCRATCH: {
  color: GfxFill
  width: number
  cap: CanvasLineCap
  join: CanvasLineJoin
  miterLimit: number
  exactJoins: boolean
  dash: readonly number[] | undefined
  dashOffset: number
} = {
  color: '#000',
  width: 1,
  cap: 'round',
  join: 'round',
  miterLimit: 4,
  exactJoins: false,
  dash: undefined,
  dashOffset: 0,
}

function strokeStyleOf(style: CStyle, item: LottieStrokeStyle) {
  STROKE_SCRATCH.color = style.fill
  STROKE_SCRATCH.width = style.width
  STROKE_SCRATCH.cap = item.cap
  STROKE_SCRATCH.join = item.join
  STROKE_SCRATCH.miterLimit = item.miterLimit
  // The default stroker draws round caps and no joins. Anything else needs the
  // outline stroker.
  STROKE_SCRATCH.exactJoins = item.cap !== 'round' || item.join !== 'round'
  STROKE_SCRATCH.dash = style.dash.length > 0 ? style.dash : undefined
  STROKE_SCRATCH.dashOffset = style.dashOffset
  return STROKE_SCRATCH
}

/** `#rrggbb` to a CSS color string. */
function parseSolidColor(hex: string): string {
  return hex.startsWith('#') ? hex : `#${hex}`
}

/**
 * Merge a gradient's color and alpha stops for `frame` into CSS color stops.
 * The flat array holds `[offset, r, g, b]` per color stop, followed by
 * `[offset, alpha]` per alpha stop when the file has them.
 */
function gradientStops(g: LottieGradient, frame: number): GfxGradientStop[] {
  const dims = g.data.dims
  const data =
    SCRATCH_GRADIENT.length >= dims
      ? SCRATCH_GRADIENT
      : (SCRATCH_GRADIENT = new Float64Array(dims))
  g.data.sample(frame, data)
  const colorCount = g.stops
  const alphaStart = colorCount * 4
  const alphaCount = Math.max(0, Math.floor((dims - alphaStart) / 2))
  const stops: GfxGradientStop[] = []
  for (let i = 0; i < colorCount; i++) {
    const offset = data[i * 4]
    const a = alphaCount > 0 ? alphaAt(data, alphaStart, alphaCount, offset) : 1
    stops.push({
      offset,
      color: rgbaCss(data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3], a),
    })
  }
  return stops
}

let SCRATCH_GRADIENT = new Float64Array(64)

function alphaAt(
  data: Float64Array,
  start: number,
  count: number,
  offset: number,
): number {
  const o0 = data[start]
  if (offset <= o0) return data[start + 1]
  for (let i = 1; i < count; i++) {
    const o1 = data[start + i * 2]
    if (offset <= o1) {
      const p = data[start + (i - 1) * 2]
      const a0 = data[start + (i - 1) * 2 + 1]
      const a1 = data[start + i * 2 + 1]
      return o1 === p ? a1 : a0 + ((a1 - a0) * (offset - p)) / (o1 - p)
    }
  }
  return data[start + (count - 1) * 2 + 1]
}

function rgbaCss(r: number, g: number, b: number, a: number): string {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)))
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)))
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)))
  return `rgba(${ri}, ${gi}, ${bi}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`
}
