// The normalized model of a Lottie animation. `parseLottie` builds it from the
// JSON, and the renderer reads it. Every animated property is already compiled
// (see `anim/props.ts`), legacy encodings are upgraded, and anything the engine
// ignores is reported in `LottieAnimation.diagnostics` instead of failing.

import type { PathProp, ValueProp } from '../anim/props'

/** A named range of frames the file defines. */
export interface LottieMarker {
  /** Marker name. */
  name: string
  /** Start frame, in the animation's own frames (includes the in point). */
  time: number
  /** Length in frames. `0` marks a single frame. */
  duration: number
}

/** Something the loader ignored or approximated. */
export interface LottieDiagnostic {
  /** Stable machine-readable id, for example `'expression'`. */
  code: string
  /** Human-readable explanation. */
  message: string
  /** Name of the layer concerned, when there is one. */
  layer?: string
}

/** The transform of a layer or a shape group. */
export interface LottieTransform {
  /** Anchor point, 2 components. */
  anchor: ValueProp
  /** Position when it is one property, otherwise `null` and see `positionX`. */
  position: ValueProp | null
  /** Separated position axes, present when `position` is `null`. */
  positionX: ValueProp | null
  positionY: ValueProp | null
  /** Scale in percent, 2 components. */
  scale: ValueProp
  /** Rotation in degrees. */
  rotation: ValueProp
  /** Skew in degrees. */
  skew: ValueProp
  /** Skew axis in degrees. */
  skewAxis: ValueProp
  /** Opacity in percent. */
  opacity: ValueProp
}

/** Layer kinds the loader understands. */
export type LottieLayerType =
  'null' | 'solid' | 'shape' | 'precomp' | 'image' | 'text' | 'unsupported'

/** Mask combine modes. */
export type LottieMaskMode =
  | 'add'
  | 'subtract'
  | 'intersect'
  | 'lighten'
  | 'darken'
  | 'difference'
  | 'none'

/** One mask on a layer. */
export interface LottieMask {
  mode: LottieMaskMode
  inverted: boolean
  path: PathProp
  /** Opacity in percent. */
  opacity: ValueProp
  /** Expansion in pixels. */
  expansion: ValueProp
}

/** How a layer's track matte source is used. */
export type LottieMatteMode =
  'none' | 'alpha' | 'inverted-alpha' | 'luma' | 'inverted-luma'

/** The fields every layer shares. */
export interface LottieLayerBase {
  type: LottieLayerType
  name: string
  /** The layer's index, which `parent` and `matteSource` refer to. */
  index: number
  /** Index of the parent layer, or `-1`. */
  parent: number
  hidden: boolean
  inPoint: number
  outPoint: number
  startTime: number
  stretch: number
  transform: LottieTransform
  autoOrient: boolean
  masks: LottieMask[]
  matteMode: LottieMatteMode
  /** Index of the layer used as matte source, or `-1` for "the layer above". */
  matteSource: number
  /** True when this layer is a matte source (`td`). */
  isMatte: boolean
  /** Canvas composite operation name, or `null` for normal. */
  blendMode: GlobalCompositeOperation | null
  /** Id of the layer's slot, if the file defines one. */
  slotId: string | null
}

export interface LottieNullLayer extends LottieLayerBase {
  type: 'null'
}

export interface LottieSolidLayer extends LottieLayerBase {
  type: 'solid'
  color: string
  width: number
  height: number
}

export interface LottieShapeLayer extends LottieLayerBase {
  type: 'shape'
  shapes: LottieShapeItem[]
}

export interface LottiePrecompLayer extends LottieLayerBase {
  type: 'precomp'
  refId: string
  width: number
  height: number
  /** Time remap in seconds, or `null`. */
  timeRemap: ValueProp | null
}

export interface LottieImageLayer extends LottieLayerBase {
  type: 'image'
  refId: string
}

/** The text and style of a text layer from a given frame on. */
export interface LottieTextDocument {
  /** First frame the document applies to. */
  frame: number
  text: string
  /** Font name as the file lists it (`fName`). */
  font: string
  size: number
  /** `0` left, `1` right, `2` center, the rest justify. */
  justify: number
  /** Letter spacing in thousandths of the font size. */
  tracking: number
  /** Distance between baselines. */
  lineHeight: number
  /** Fill color as `[r, g, b]` in `[0, 1]`, or `null`. */
  fill: readonly number[] | null
  stroke: readonly number[] | null
  strokeWidth: number
}

export interface LottieTextLayer extends LottieLayerBase {
  type: 'text'
  /** The documents in frame order. */
  documents: LottieTextDocument[]
  /** Number of text animators, which are not applied. */
  animators: number
}

/** A glyph embedded in the file, drawn as vector shapes. */
export interface LottieGlyph {
  /** The character. */
  char: string
  family: string
  style: string
  /** The font size the outline is drawn at. */
  size: number
  /** Advance width at `size`. */
  width: number
  shapes: LottieShapeItem[]
}

export interface LottieUnsupportedLayer extends LottieLayerBase {
  type: 'unsupported'
}

export type LottieLayer =
  | LottieNullLayer
  | LottieSolidLayer
  | LottieShapeLayer
  | LottiePrecompLayer
  | LottieImageLayer
  | LottieTextLayer
  | LottieUnsupportedLayer

// --- shape items -------------------------------------------------------------

/** Fields every shape item shares. */
export interface LottieShapeBase {
  name: string
  /** Path direction: `1` clockwise, `3` counter-clockwise. */
  direction: number
}

export interface LottieGroupItem extends LottieShapeBase {
  kind: 'group'
  items: LottieShapeItem[]
}
export interface LottiePathItem extends LottieShapeBase {
  kind: 'path'
  path: PathProp
}
export interface LottieRectItem extends LottieShapeBase {
  kind: 'rect'
  position: ValueProp
  size: ValueProp
  roundness: ValueProp
}
export interface LottieEllipseItem extends LottieShapeBase {
  kind: 'ellipse'
  position: ValueProp
  size: ValueProp
}
export interface LottieStarItem extends LottieShapeBase {
  kind: 'star'
  /** `1` star, `2` polygon. */
  starType: number
  position: ValueProp
  points: ValueProp
  rotation: ValueProp
  innerRadius: ValueProp | null
  outerRadius: ValueProp
  innerRoundness: ValueProp | null
  outerRoundness: ValueProp
}

/** Fill rule of a fill item. */
export type LottieFillRule = 'nonzero' | 'evenodd'

export interface LottieFillItem extends LottieShapeBase {
  kind: 'fill'
  color: ValueProp
  opacity: ValueProp
  rule: LottieFillRule
}

/** A gradient definition: stop count and the animated flat stop array. */
export interface LottieGradient {
  /** Number of color stops. */
  stops: number
  /** Flat array: `stops * 4` color floats, then optional alpha pairs. */
  data: ValueProp
}

export interface LottieGradientFillItem extends LottieShapeBase {
  kind: 'gradient-fill'
  /** `1` linear, `2` radial. */
  gradientType: number
  start: ValueProp
  end: ValueProp
  /** Highlight length in percent, radial only. */
  highlightLength: ValueProp | null
  /** Highlight angle in degrees, radial only. */
  highlightAngle: ValueProp | null
  gradient: LottieGradient
  opacity: ValueProp
  rule: LottieFillRule
}

/** Stroke fields shared by plain and gradient strokes. */
export interface LottieStrokeStyle {
  width: ValueProp
  opacity: ValueProp
  cap: CanvasLineCap
  join: CanvasLineJoin
  miterLimit: number
  /** Animated miter limit, when the file has one. */
  miterLimitProp: ValueProp | null
  /**
   * Dash entries in order, as `[kind, value]` where kind is `'d'`, `'g'` or
   * `'o'`.
   */
  dashes: Array<{ kind: 'd' | 'g' | 'o'; value: ValueProp }>
}

export interface LottieStrokeItem extends LottieShapeBase, LottieStrokeStyle {
  kind: 'stroke'
  color: ValueProp
}

export interface LottieGradientStrokeItem
  extends LottieShapeBase, LottieStrokeStyle {
  kind: 'gradient-stroke'
  gradientType: number
  start: ValueProp
  end: ValueProp
  highlightLength: ValueProp | null
  highlightAngle: ValueProp | null
  gradient: LottieGradient
}

export interface LottieTrimItem extends LottieShapeBase {
  kind: 'trim'
  start: ValueProp
  end: ValueProp
  offset: ValueProp
  /** `1` simultaneous, `2` individual. */
  multiple: number
}

export interface LottieRepeaterItem extends LottieShapeBase {
  kind: 'repeater'
  copies: ValueProp
  offset: ValueProp
  /** `1` copies stack above the original, `2` below. */
  composite: number
  transform: {
    anchor: ValueProp
    position: ValueProp
    scale: ValueProp
    rotation: ValueProp
    startOpacity: ValueProp
    endOpacity: ValueProp
  }
}

export interface LottieRoundCornersItem extends LottieShapeBase {
  kind: 'round-corners'
  radius: ValueProp
}
export interface LottieOffsetPathItem extends LottieShapeBase {
  kind: 'offset-path'
  amount: ValueProp
  miterLimit: ValueProp
  /** `1` miter, `2` round, `3` bevel. */
  join: number
}
export interface LottieZigZagItem extends LottieShapeBase {
  kind: 'zig-zag'
  size: ValueProp
  frequency: ValueProp
  /** `1` corner, `2` smooth. */
  pointType: number
}
export interface LottiePuckerBloatItem extends LottieShapeBase {
  kind: 'pucker-bloat'
  amount: ValueProp
}
export interface LottieMergePathsItem extends LottieShapeBase {
  kind: 'merge-paths'
  mode: number
}
export interface LottieTwistItem extends LottieShapeBase {
  kind: 'twist'
}
export interface LottieTransformItem extends LottieShapeBase {
  kind: 'transform'
  transform: LottieTransform
}

export type LottieShapeItem =
  | LottieGroupItem
  | LottiePathItem
  | LottieRectItem
  | LottieEllipseItem
  | LottieStarItem
  | LottieFillItem
  | LottieGradientFillItem
  | LottieStrokeItem
  | LottieGradientStrokeItem
  | LottieTrimItem
  | LottieRepeaterItem
  | LottieRoundCornersItem
  | LottieOffsetPathItem
  | LottieZigZagItem
  | LottiePuckerBloatItem
  | LottieMergePathsItem
  | LottieTwistItem
  | LottieTransformItem

// --- composition -------------------------------------------------------------

/** A precomposition or image from the file's asset list. */
export interface LottieAsset {
  id: string
  /** Layers, for a precomposition. */
  layers: LottieLayer[] | null
  /** Image source fields, for an image asset. */
  image: {
    path: string
    dir: string
    embedded: boolean
    width: number
    height: number
  } | null
}

/** A font the file declares. */
export interface LottieFont {
  family: string
  name: string
  style: string
  path: string
  /** `0` local, `1` CSS URL, `2` script URL, `3` font file URL. */
  origin: number
}

/**
 * A parsed animation. Read the timing and size fields to lay it out, hand it to
 * a `LottiePlayer` or a `LottieNode` to play it.
 *
 * @remarks
 *   Engine developers: `layers`, `assets` and `fonts` hold the compiled model the
 *   renderer walks. The public surface for consumers is the timing fields,
 *   `markers`, `layerNames`, `slotIds` and `diagnostics`.
 */
export interface LottieAnimation {
  /** Width in pixels of the composition. */
  readonly width: number
  /** Height in pixels of the composition. */
  readonly height: number
  /** Frames per second. */
  readonly frameRate: number
  /** First frame (`ip`). */
  readonly inPoint: number
  /** End frame, exclusive (`op`). */
  readonly outPoint: number
  /** Number of frames, `outPoint - inPoint`. */
  readonly totalFrames: number
  /** Duration in milliseconds. */
  readonly durationMs: number
  /** Markers the file defines. */
  readonly markers: readonly LottieMarker[]
  /** Names of the top-level layers. */
  readonly layerNames: readonly string[]
  /** Ids of every slot the file defines. */
  readonly slotIds: readonly string[]
  /** What the loader ignored or approximated. */
  readonly diagnostics: readonly LottieDiagnostic[]
  /** Properties that carry a slot id, which themes and slots replace. @internal */
  readonly slotProps: ReadonlyMap<string, readonly ValueProp[]>
  /** The root composition's layers. */
  readonly layers: readonly LottieLayer[]
  /** Precompositions and images by id. */
  readonly assets: ReadonlyMap<string, LottieAsset>
  /** Fonts the file declares. */
  readonly fonts: readonly LottieFont[]
  /** Glyph outlines embedded in the file. */
  readonly glyphs: readonly LottieGlyph[]
}
