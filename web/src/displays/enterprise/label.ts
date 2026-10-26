/**
 * Enterprise's game-over label: the score over a sliced gradient with stylized
 * data packets, a caption that reads "Points" or "New high score", the player's
 * name when they gave one, the label URL, and the Firefox Enterprise icon.
 * Players pick one of three color variants.
 *
 * The label is a stargazer scene, built by {@link buildLabelScene} and rendered
 * through the running engine's capture, so it draws with the same nodes, text,
 * gradients and effects as the screen. The capture renders at exactly the
 * label's pixel size, independent of the display's pixel ratio.
 *
 * VC-500W tape is continuous, only the cross-tape dimension is fixed. We render
 * square (edge = tape width px), daemon sends `<print autofit=1>` so hardware
 * corrects any small size mismatch without clipping.
 *
 * Every length is in the Figma comp's 330 × 330 units, scaled to the label.
 */

import { get } from 'svelte/store'
import {
  cssLinearGradient,
  fontMetrics,
  ImageNode,
  Layer,
  measureText,
  Node2D,
  parseSvgPaths,
  Path2DNode,
  ShapeNode,
  TextNode,
  type Engine,
  type GfxFill,
  type GfxShadowStyle,
} from 'stargazer'
import type { GameOverReason, RegionId } from './game'
import type { EnterpriseHighScores as HighScores } from './game-log'
import type { EnterpriseMessages } from './i18n/types'
import { SliceShift } from './background/SliceShift'
import { daemonConfig, DEFAULT_LABEL_URL } from '@src/stores/daemonConfig'
import { preloadFonts } from '@src/core/fonts'
import { displayName } from '@src/core/leaderboard/displayName'

import packetsSvg from './assets/label-packets.svg?raw'
import iconUrl from './assets/firefox-enterprise-icon.svg?url'

/**
 * Font families the label draws with. Declared as `@font-face` in
 * `styles/fonts.scss` and awaited at boot by `core/fonts`, so these are plain
 * references to faces the document already has.
 */
const FONT_SCORE = '"Mozilla Headline Extended", sans-serif'
const FONT_CAPTION = '"Mozilla Headline Condensed", sans-serif'
const FONT_TEXT = '"Mozilla Text", sans-serif'

/** The label's color variants, which players pick before printing. */
export const LABEL_VARIANTS = ['purple', 'orange', 'pink'] as const
export type LabelVariant = (typeof LABEL_VARIANTS)[number]
export const DEFAULT_LABEL_VARIANT: LabelVariant = 'purple'

/** Everything the label needs, the `gameOver` payload plus the player's picks. */
export interface LabelInput {
  reason: GameOverReason
  stateId: RegionId
  /** The map the round was played on. */
  mapId: string
  score: number
  isOverallHigh: boolean
  isStateHigh: boolean
  highScores: HighScores
  escapeHeadingRad?: number
  printedAt?: Date
  /** Default {@link DEFAULT_LABEL_VARIANT}. */
  variant?: LabelVariant
  /** The name on the pill. Without one the pill is left out. */
  name?: string
}

/**
 * The label a recorded round was printed with, for printing it again. A round
 * printed before players could pick, or never printed, gets the default variant
 * with no name.
 */
export function labelPicksOf(record: {
  labelVariant?: LabelVariant
  labelName?: string
}): Pick<LabelInput, 'variant' | 'name'> {
  return {
    variant: record.labelVariant ?? DEFAULT_LABEL_VARIANT,
    name: record.labelName,
  }
}

export interface LabelRenderOptions {
  /** Resolved locale strings, passed in so the renderer has no store dependency. */
  messages: EnterpriseMessages
  /** Square edge in px. */
  size: number
  /** Non-square escape hatch (overrides `size`). */
  width?: number
  height?: number
  /** JPEG quality 0..1. */
  quality?: number
}

/** Images the scene draws. Without them the icon is left out. */
export interface LabelAssets {
  /** The icon, already rasterized at the size it is drawn at. */
  icon: CanvasImageSource
}

/** The comp's edge, the unit every length is measured in. */
const DESIGN = 330

const INK = '#010612'

/** The icon's place and size. */
const ICON = { x: 266, y: 266, size: 48 }

let iconImage: Promise<HTMLImageElement> | null = null
const iconRasters = new Map<number, Promise<ImageBitmap>>()

function loadIcon(): Promise<HTMLImageElement> {
  iconImage ??= (async () => {
    const img = new Image()
    img.src = iconUrl
    await img.decode()
    return img
  })().catch((err: unknown) => {
    iconImage = null
    throw err
  })
  return iconImage
}

/**
 * The icon rasterized once per pixel size. The GPU samples an image without
 * mipmaps, so the vector is drawn at exactly the size it shows at.
 */
function iconRaster(px: number): Promise<ImageBitmap> {
  let raster = iconRasters.get(px)
  if (!raster) {
    raster = loadIcon().then((img) => {
      const canvas = new OffscreenCanvas(px, px)
      canvas.getContext('2d')!.drawImage(img, 0, 0, px, px)
      return canvas.transferToImageBitmap()
    })
    raster.catch(() => iconRasters.delete(px))
    iconRasters.set(px, raster)
  }
  return raster
}

async function loadAssets(edge: number): Promise<LabelAssets> {
  const scale = edge / DESIGN
  return { icon: await iconRaster(Math.round(ICON.size * scale)) }
}

/** What a capture needs beyond the scene: fonts, the icon, and the URL. */
async function prepare(edge: number): Promise<LabelSceneExtras> {
  const [assets] = await Promise.all([
    loadAssets(edge),
    // Boot already awaited these; re-awaiting is cheap and keeps the renderer
    // correct if it is ever driven outside the normal boot path.
    preloadFonts(),
  ])
  return { assets, labelUrl: get(daemonConfig).labelUrl }
}

/**
 * Render the label and encode it as a JPEG blob, through `engine`. Awaits fonts
 * and the icon, then captures the scene {@link buildLabelScene} builds.
 */
export async function renderLabel(
  engine: Engine,
  input: LabelInput,
  opts: LabelRenderOptions,
): Promise<Blob> {
  const width = opts.width ?? opts.size
  const height = opts.height ?? opts.size
  const extras = await prepare(Math.min(width, height))
  return engine.captureBlob({
    width,
    height,
    type: 'image/jpeg',
    quality: opts.quality ?? 0.92,
    clearColor: '#ffffff',
    build: (root) =>
      buildLabelScene(root, input, opts.messages, width, height, extras),
  })
}

/**
 * Render the label as a bitmap `size` pixels square, for showing it on screen
 * before it prints.
 */
export async function renderLabelPreview(
  engine: Engine,
  input: LabelInput,
  messages: EnterpriseMessages,
  size: number,
): Promise<ImageBitmap> {
  const extras = await prepare(size)
  return engine.capture({
    width: size,
    height: size,
    clearColor: '#ffffff',
    build: (root) => buildLabelScene(root, input, messages, size, size, extras),
  })
}

/** What {@link buildLabelScene} draws beyond the round itself. */
export interface LabelSceneExtras {
  /** Without them the icon is left out. */
  assets?: LabelAssets
  /** The URL in the corner. Defaults to {@link DEFAULT_LABEL_URL}. */
  labelUrl?: string
}

/**
 * Add the label's nodes to `root`, one unit per pixel with the origin at the
 * top left of a `w` × `h` label.
 */
export function buildLabelScene(
  root: Node2D,
  input: LabelInput,
  messages: EnterpriseMessages,
  w: number,
  h: number,
  { assets, labelUrl = DEFAULT_LABEL_URL }: LabelSceneExtras = {},
): void {
  // The comp scales to the shorter side and centers in the longer one.
  const scale = Math.min(w, h) / DESIGN
  const left = (w - DESIGN * scale) / 2
  const top = (h - DESIGN * scale) / 2
  const at = (x: number, y: number) => ({
    x: left + x * scale,
    y: top + y * scale,
  })

  root.add(backgroundLayer(input.variant ?? DEFAULT_LABEL_VARIANT, w, h))

  const isHigh = input.isOverallHigh || input.isStateHigh
  const center = at(DESIGN / 2, 0).x

  const score = text('label-score', String(input.score), {
    font: FONT_SCORE,
    size: fitSize(String(input.score), FONT_SCORE, 138.735, 290) * scale,
  })
  score.x = center
  score.align = 'center'
  score.y = at(0, 242).y - fontMetrics(score.fontString(score.fontSize)).descent

  const captionText = isHigh
    ? messages.game.newHighScoreBanner.toUpperCase()
    : input.score === 1
      ? messages.game.point
      : messages.game.points
  const caption = text('label-caption', captionText, {
    font: FONT_CAPTION,
    size: fitSize(captionText, FONT_CAPTION, 26.4, 252) * scale,
  })
  caption.x = center
  caption.align = 'center'
  caption.y =
    at(0, 252).y - fontMetrics(caption.fontString(caption.fontSize)).descent

  const url = text('label-url', labelUrl, {
    font: FONT_TEXT,
    size: 14 * scale,
    color: '#ffffff',
  })
  url.x = at(22, 0).x
  url.y = at(0, 310).y - fontMetrics(url.fontString(url.fontSize)).descent

  root.add(score, caption, url)

  if (assets) {
    const corner = at(ICON.x, ICON.y)
    root.add(
      new ImageNode({
        id: 'label-icon',
        image: assets.icon,
        x: Math.round(corner.x),
        y: Math.round(corner.y),
        width: Math.round(ICON.size * scale),
        height: Math.round(ICON.size * scale),
      }),
    )
  }

  // The packets pass over the text, as in the comp, and the name sits on top.
  const packets = new Node2D('label-packets')
  packets.transform.x = left
  packets.transform.y = top
  packets.transform.scaleX = scale
  packets.transform.scaleY = scale
  for (const packet of packetNodes()) packets.add(packet)
  root.add(packets)

  const name = input.name?.trim()
  if (name) root.add(...namePill(displayName(name), at(165, 61.8), scale))
}

function text(
  id: string,
  value: string,
  style: { font: string; size: number; color?: string },
): TextNode {
  return new TextNode({
    id,
    text: value,
    fontFamily: style.font,
    fontWeight: 700,
    fontSize: style.size,
    color: style.color ?? INK,
  })
}

/** `size`, shrunk until `value` is no wider than `width`, in comp units. */
function fitSize(
  value: string,
  font: string,
  size: number,
  width: number,
): number {
  const advance = measureText(value, {
    font: `700 ${size}px ${font}`,
    align: 'left',
    baseline: 'alphabetic',
    color: INK,
  }).advance
  return advance > width ? (size * width) / advance : size
}

/** The white pill holding the player's name, centered on `middle`. */
function namePill(
  name: string,
  middle: { x: number; y: number },
  scale: number,
): [ShapeNode, TextNode] {
  const label = text('label-name', name, {
    font: FONT_CAPTION,
    size: 26.4 * scale,
  })
  const font = label.fontString(label.fontSize)
  const metrics = fontMetrics(font)
  const textHeight = metrics.ascent + metrics.descent
  const advance = measureText(name, {
    font,
    align: 'left',
    baseline: 'alphabetic',
    color: INK,
  }).advance
  const height = textHeight + 2 * 4.8 * scale
  const width = advance + 2 * 14.4 * scale
  const pill = new ShapeNode({
    id: 'label-name-pill',
    geometry: {
      kind: 'rect',
      width,
      height,
      centered: false,
      radii: height / 2,
    },
    fill: '#ffffff',
  })
  pill.transform.x = middle.x - width / 2
  pill.transform.y = middle.y - height / 2
  label.x = middle.x
  label.align = 'center'
  label.y = Math.round(middle.y - textHeight / 2 + metrics.ascent)
  return [pill, label]
}

/** The purple variant's radial gradient stops. */
const PURPLE_STOPS = [
  { offset: 0, color: '#F5F4F9' },
  { offset: 0.5, color: '#D1C3F4' },
  { offset: 0.75, color: '#A996E7' },
  { offset: 1, color: '#8268DA' },
]

/**
 * The purple gradient's SVG transform, `matrix(a b c d e f)`, which maps its
 * radius 10 circle at the origin onto the comp.
 */
export const PURPLE_GRADIENT_MATRIX = {
  a: 21.262,
  b: 35.163,
  c: -35.163,
  d: 67.197,
  e: 11.344,
  f: -15.125,
}
const PURPLE_GRADIENT_RADIUS = 10

/**
 * The rotation and the two axis scales that map a circle centered on the origin
 * onto the same ellipse as the linear part of `m`. Any 2D linear map is a
 * rotation, an axis scale and a second rotation, and the second rotation leaves
 * a circle unchanged, so a node's rotation and scale can reproduce a skewed
 * gradient matrix on a round gradient.
 */
export function ellipseOfMatrix(m: {
  a: number
  b: number
  c: number
  d: number
}): { rotation: number; scaleX: number; scaleY: number } {
  // The ellipse's axes are the eigenvectors of M Mᵀ, its radii the square
  // roots of the eigenvalues.
  const xx = m.a * m.a + m.c * m.c
  const xy = m.a * m.b + m.c * m.d
  const yy = m.b * m.b + m.d * m.d
  const mean = (xx + yy) / 2
  const spread = Math.hypot((xx - yy) / 2, xy)
  return {
    rotation: Math.atan2(2 * xy, xx - yy) / 2,
    scaleX: Math.sqrt(mean + spread),
    scaleY: Math.sqrt(Math.max(0, mean - spread)),
  }
}

/** A variant's gradient, filling `w` × `h`. */
function backgroundNode(variant: LabelVariant, w: number, h: number): Node2D {
  if (variant === 'orange' || variant === 'pink') {
    const fill: GfxFill =
      variant === 'orange'
        ? cssLinearGradient(w, h, -45, [
            { offset: 0.2, color: '#FFDDAB' },
            { offset: 0.5, color: '#FEAE51' },
            { offset: 0.8, color: '#FD7444' },
          ])
        : cssLinearGradient(w, h, 135, [
            { offset: 0.2, color: '#F585B6' },
            { offset: 0.5, color: '#E3ADA3' },
            { offset: 0.82692, color: '#E4D7FC' },
          ])
    return new ShapeNode({
      id: 'label-gradient',
      geometry: { kind: 'rect', width: w, height: h, centered: false },
      fill,
    })
  }

  // The gradient's own frame, where it is a circle. Its rect is the label's
  // corners carried back into that frame.
  const scale = Math.min(w, h) / DESIGN
  const m = PURPLE_GRADIENT_MATRIX
  const ellipse = ellipseOfMatrix(m)
  const frame = new Node2D('label-gradient-frame')
  frame.transform.x = (w - DESIGN * scale) / 2 + m.e * scale
  frame.transform.y = (h - DESIGN * scale) / 2 + m.f * scale
  frame.transform.rotation = ellipse.rotation
  frame.transform.scaleX = ellipse.scaleX * scale
  frame.transform.scaleY = ellipse.scaleY * scale
  const cos = Math.cos(-ellipse.rotation)
  const sin = Math.sin(-ellipse.rotation)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    const dx = x - frame.transform.x
    const dy = y - frame.transform.y
    const lx = (dx * cos - dy * sin) / frame.transform.scaleX
    const ly = (dx * sin + dy * cos) / frame.transform.scaleY
    minX = Math.min(minX, lx)
    minY = Math.min(minY, ly)
    maxX = Math.max(maxX, lx)
    maxY = Math.max(maxY, ly)
  }
  const gradient = new ShapeNode({
    id: 'label-gradient',
    geometry: {
      kind: 'rect',
      width: maxX - minX,
      height: maxY - minY,
      centered: false,
    },
    fill: {
      kind: 'radial',
      cx: -minX,
      cy: -minY,
      r: PURPLE_GRADIENT_RADIUS,
      stops: PURPLE_STOPS,
    },
  })
  gradient.transform.x = minX
  gradient.transform.y = minY
  frame.add(gradient)
  return frame
}

/** Columns the background is sliced into. */
export const LABEL_SLICE_COLUMNS = 5

/** The variant's gradient, sliced as the game's backdrop is. */
function backgroundLayer(variant: LabelVariant, w: number, h: number): Layer {
  const layer = new Layer({
    id: 'label-background',
    region: { x: 0, y: 0, width: w, height: h },
    effects: [new SliceShift({ columns: LABEL_SLICE_COLUMNS })],
  })
  layer.add(backgroundNode(variant, w, h))
  return layer
}

interface PacketSpec {
  id: string
  /** The Figma wrapper box the rotated shape is centered in. */
  box: { x: number; y: number; width: number; height: number }
  /** The shape's own size, its SVG viewBox. */
  size: { width: number; height: number }
}

/** Every packet shape turns by the same angle. */
const PACKET_ROTATION = (127.33 * Math.PI) / 180

const TAILS: PacketSpec[] = [
  {
    id: 'tail-2',
    box: { x: 39, y: -107, width: 282.057, height: 239.44 },
    size: { width: 73.0788, height: 299 },
  },
  {
    id: 'tail-3',
    box: { x: -62, y: -71, width: 167.942, height: 142.567 },
    size: { width: 43.5124, height: 178.03 },
  },
  {
    id: 'tail-5',
    box: { x: -145, y: 42, width: 212.057, height: 180.016 },
    size: { width: 54.9424, height: 224.795 },
  },
]

const HEADS: PacketSpec[] = [
  {
    id: 'hex-1',
    box: { x: 227.02, y: 39.43, width: 76.964, height: 76.964 },
    size: { width: 47.5558, height: 54.9127 },
  },
  {
    id: 'hex-4',
    box: { x: 49.95, y: 16.19, width: 45.826, height: 45.826 },
    size: { width: 28.3156, height: 32.696 },
  },
  {
    id: 'hex-6',
    box: { x: -3.64, y: 152.09, width: 57.864, height: 57.864 },
    size: { width: 35.7536, height: 41.2847 },
  },
]

const TAIL_SHADOWS: GfxShadowStyle[] = [
  { color: '#ffffff', blur: 15.2752, inset: true },
  { color: '#ffffff', blur: 15.2752, inset: true },
]

const HEAD_SHADOWS: GfxShadowStyle[] = [
  { color: '#ffffff', blur: 28.4278, inset: true },
  {
    color: 'rgba(255, 255, 255, 0.8)',
    offsetY: -25.777,
    blur: 20.6216,
    inset: true,
  },
]

let packetPaths: ReadonlyMap<string, Path2D> | null = null

/** The packet outlines from `label-packets.svg`, parsed and tessellated once. */
function packetPath(id: string): Path2D {
  if (!packetPaths) {
    const { paths } = parseSvgPaths(packetsSvg, { tessellate: true })
    packetPaths = new Map([...paths].map(([key, entry]) => [key, entry.path]))
  }
  const path = packetPaths.get(id)
  if (!path) throw new Error(`label-packets.svg has no path ${id}`)
  return path
}

/** The packet shapes in comp units: the tails, then the heads over them. */
function packetNodes(): Path2DNode[] {
  const node = (
    spec: PacketSpec,
    style: {
      fill: string
      stroke: string
      lineWidth: number
      shadow: GfxShadowStyle[]
    },
  ): Path2DNode => {
    const shape = new Path2DNode({
      id: `label-${spec.id}`,
      path: packetPath(spec.id),
      ...style,
      lineAlign: 'inside',
      strokeSpace: 'world',
      bounds: { x: 0, y: 0, ...spec.size },
    })
    shape.transform.originX = spec.size.width / 2
    shape.transform.originY = spec.size.height / 2
    shape.transform.x = spec.box.x + spec.box.width / 2
    shape.transform.y = spec.box.y + spec.box.height / 2
    shape.transform.rotation = PACKET_ROTATION
    return shape
  }
  return [
    ...TAILS.map((spec) =>
      node(spec, {
        fill: 'rgba(255, 255, 255, 0.2)',
        stroke: 'rgba(255, 255, 255, 0.9)',
        lineWidth: 3.05505,
        shadow: TAIL_SHADOWS,
      }),
    ),
    ...HEADS.map((spec) =>
      node(spec, {
        fill: 'rgba(255, 255, 255, 0.15)',
        stroke: '#ffffff',
        lineWidth: 4.07339,
        shadow: HEAD_SHADOWS,
      }),
    ),
  ]
}
