import type { EngineHost, EngineHostOptions } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { Node2D } from '../scene/Node2D'
import { Layer, type LayerCache } from '../scene/Layer'
import { DualKawaseBlur } from '../render/postfx/effects/DualKawaseBlur'
import { ShapeNode } from '../nodes/ShapeNode'
import { LottieNode } from '../nodes/LottieNode'
import { MeshNode, createBoxGeometry } from '../nodes/MeshNode'
import { DirectionalLight3D } from '../nodes/Light3D'
import { CameraNode3D } from '../camera/CameraNode3D'
import { quat, quatFromAxisAngle } from '../math/Quat'
import { GfxPath } from '../render/gfx/GfxPath'
import { parseLottie } from '../lottie/model/parse'
import type { LottieAnimation } from '../lottie/model/types'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Canvas } from '../render/picture/Canvas'
import type { SceneTree } from '../scene/SceneTree'

// Benchmark scenes. Each one isolates a kind of work so a slow result points at
// a cause: run breaks, instancing, text, textures, paths, fill rate, offscreen
// surfaces or 3D. 2D scenes lay out in a 1920 x 1080 view that the camera fits
// to the canvas, so the pixel count changes with the screen and the content
// does not. Animated scenes advance from `dt`, so a slow machine shows the
// same motion at fewer frames.

export interface BenchScene {
  /** Populates the scene. `n` is the scene's size knob. */
  build(scene: SceneTree, n: number, canvas: HTMLCanvasElement): void
  /** Engine options the scene needs, merged over the runner's. */
  host?: Partial<EngineHostOptions>
  /** Runs after `build`, for engine settings that are not host options. */
  after?(host: EngineHost): void
  /** False for scenes that bring their own 3D camera. */
  camera2D?: boolean
}

const VIEW = { x: 0, y: 0, width: 1920, height: 1080 }

/** A `#rrggbb` color at `deg` degrees of hue, the form `parseColor` accepts. */
function hue(deg: number): string {
  const h = (((deg % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] =
    h < 1
      ? [1, x, 0]
      : h < 2
        ? [x, 1, 0]
        : h < 3
          ? [0, 1, x]
          : h < 4
            ? [0, x, 1]
            : h < 5
              ? [x, 0, 1]
              : [1, 0, x]
  const hex = (v: number): string =>
    Math.round(60 + v * 160)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** A deterministic pseudo-random sequence, so every run draws the same scene. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** `count` small, distinct images, each its own texture in the engine. */
function makeIcons(count: number): HTMLCanvasElement[] {
  const icons: HTMLCanvasElement[] = []
  for (let i = 0; i < count; i++) {
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    const ctx = c.getContext('2d')!
    ctx.fillStyle = hue(i * 47)
    ctx.beginPath()
    ctx.arc(24, 24, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String.fromCharCode(65 + (i % 26)), 24, 25)
    icons.push(c)
  }
  return icons
}

let iconCache: HTMLCanvasElement[] | null = null
function icons(): HTMLCanvasElement[] {
  iconCache ??= makeIcons(32)
  return iconCache
}

/** Centre `count` cells of `w` x `h` in the view, row by row. */
function tile(
  count: number,
  w: number,
  h: number,
): { x: number; y: number; scale: number }[] {
  const cols = Math.max(
    1,
    Math.ceil(Math.sqrt((count * VIEW.width * h) / (VIEW.height * w))),
  )
  const rows = Math.ceil(count / cols)
  const scale = Math.min(VIEW.width / (cols * w), VIEW.height / (rows * h))
  const out: { x: number; y: number; scale: number }[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: (i % cols) * w * scale,
      y: Math.floor(i / cols) * h * scale,
      scale,
    })
  }
  return out
}

/** `count` filled rects tiled over the view, added to `parent`. */
function rectGrid(parent: Node2D, count: number): void {
  const cells = tile(count, 120, 80)
  for (let i = 0; i < count; i++) {
    const { x, y, scale } = cells[i]
    const node = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: 100 * scale,
        height: 60 * scale,
        centered: false,
      },
      fill: hue(i * 23),
    })
    node.transform.x = x
    node.transform.y = y
    parent.add(node)
  }
}

/**
 * A layer over the whole view holding `n` rects, with a blur and the given
 * cache setting. It never changes, so a cached one draws from its kept render
 * after the first frame.
 */
function blurredLayer(scene: SceneTree, n: number, cache: LayerCache): void {
  const layer = new Layer({
    effects: [new DualKawaseBlur({ levels: 3 })],
    region: 'view',
    cache,
  })
  rectGrid(layer, n)
  scene.root.add(layer)
}

/** A layer holding `n` rects and no effects, so the cache is all it has. */
function plainLayer(scene: SceneTree, n: number, cache: LayerCache): void {
  const layer = new Layer({ region: 'view', cache })
  rectGrid(layer, n)
  scene.root.add(layer)
}

class BlendRect extends Node2D {
  readonly color: string
  readonly additive: boolean
  constructor(color: string, additive: boolean) {
    super()
    this.color = color
    this.additive = additive
  }
  override draw(gfx: Gfx2D): void {
    gfx.setBlend(this.additive ? 'lighter' : 'source-over')
    gfx.fillRect(0, 0, 12, 12, this.color)
  }
}

class Label extends Node2D {
  readonly text: string
  readonly color: string
  constructor(text: string, color: string) {
    super()
    this.text = text
    this.color = color
  }
  override draw(gfx: Gfx2D): void {
    gfx.fillText(this.text, 0, 0, {
      font: '18px sans-serif',
      color: this.color,
    })
  }
}

/** Scales its children up and down, so their text crosses raster buckets. */
class Breathing extends Node2D {
  #t = 0
  onUpdate(dt: number): void {
    this.#t += dt
    const s = 1 + 0.4 * Math.sin(this.#t * 2)
    this.transform.scaleX = s
    this.transform.scaleY = s
  }
}

class Icon extends Node2D {
  readonly image: HTMLCanvasElement
  constructor(image: HTMLCanvasElement) {
    super()
    this.image = image
  }
  override draw(gfx: Gfx2D): void {
    gfx.drawImage(this.image, 0, 0, 32, 32)
  }
}

/** The drawing calls a card face makes, which `Gfx2D` and `Canvas` both have. */
type FaceSurface = Pick<
  Gfx2D,
  | 'fillRoundRect'
  | 'strokeRoundRect'
  | 'fillText'
  | 'fillCircle'
  | 'fillRect'
  | 'setClip'
  | 'drawImage'
  | 'strokePolyline'
>

/**
 * A playing card face built the way UI content is: rounded rects, several text
 * lines, a few icons, a circle-clipped pixel portrait and some pips. A third of
 * the cards flip continuously by squashing `scaleX`.
 */
class Card extends Node2D {
  static readonly W = 180
  static readonly H = 260
  readonly #index: number
  readonly #portrait: HTMLCanvasElement
  readonly #flips: boolean
  #t: number
  constructor(index: number) {
    super()
    this.#index = index
    this.#flips = index % 3 === 0
    this.#t = index * 0.37
    this.transform.originX = Card.W / 2
    this.transform.originY = Card.H / 2
    // A 16 x 16 portrait of horizontal runs of one hue each.
    const rand = seeded(index + 1)
    const portrait = document.createElement('canvas')
    portrait.width = 16
    portrait.height = 16
    const pctx = portrait.getContext('2d')!
    for (let y = 0; y < 16; y++) {
      let x = 0
      while (x < 16) {
        const len = Math.min(1 + Math.floor(rand() * 4), 16 - x)
        pctx.fillStyle = hue(Math.floor(rand() * 360))
        pctx.fillRect(x, y, len, 1)
        x += len
      }
    }
    this.#portrait = portrait
  }
  onUpdate(dt: number): void {
    if (!this.#flips) return
    this.#t += dt
    this.transform.scaleX = Math.max(0.02, Math.abs(Math.cos(this.#t * 1.5)))
  }
  override draw(gfx: Gfx2D): void {
    this.face(gfx)
  }

  /** The face, drawn through anything with the drawing calls it uses. */
  protected face(gfx: FaceSurface): void {
    const i = this.#index
    const W = Card.W
    gfx.fillRoundRect(0, 0, W, Card.H, 14, '#f4efe6')
    gfx.strokeRoundRect(0, 0, W, Card.H, 14, { color: '#3a3340', width: 2 })
    gfx.fillRoundRect(8, 8, W - 16, 34, 8, hue(i * 29))
    gfx.fillText(`Card ${i + 1}`, 16, 25, {
      font: 'bold 16px sans-serif',
      color: '#ffffff',
      baseline: 'middle',
    })
    gfx.fillText(String((i * 7) % 99), W - 16, 25, {
      font: 'bold 16px sans-serif',
      color: '#ffffff',
      align: 'right',
      baseline: 'middle',
    })
    // Portrait.
    const cx = W / 2
    const cy = 100
    gfx.fillCircle(cx, cy, 46, '#2b2530')
    gfx.setClip({ kind: 'circle', cx, cy, r: 44 })
    const px = 5.5
    const ox = cx - 8 * px
    const oy = cy - 8 * px
    gfx.drawImage(this.#portrait, ox, oy, 16 * px, 16 * px, {
      smoothing: false,
    })
    gfx.setClip(null)
    // Body text.
    const lines = [
      'Moves two spaces',
      'when played first,',
      'then draws a card.',
    ]
    for (let l = 0; l < lines.length; l++) {
      gfx.fillText(lines[l], 16, 166 + l * 18, {
        font: '13px sans-serif',
        color: '#3a3340',
      })
    }
    // Icons and pips.
    const set = icons()
    for (let k = 0; k < 4; k++) {
      gfx.drawImage(set[(i + k * 5) % set.length], 14 + k * 40, 218, 28, 28)
    }
    for (let k = 0; k < 5; k++) {
      gfx.fillCircle(W - 18, 60 + k * 14, 4, k <= i % 5 ? '#d9534f' : '#d8d0c4')
    }
  }
}

/** The same card, recorded once and replayed. Flipping only moves it. */
class PaintCard extends Card {
  override paint(canvas: Canvas): void {
    this.face(canvas)
  }
}

/** The same card, recorded again every frame, which is the cost of a repaint. */
class RepaintCard extends PaintCard {
  override onUpdate(dt: number): void {
    super.onUpdate(dt)
    this.markNeedsPaint()
  }
}

/**
 * A telemetry panel of the kind a game updates every frame: a frame, a few text
 * lines, a bar and a 64 point trace, all driven by one value that moves with
 * time. Drawn directly, it is the cost of content that cannot rest.
 */
class Panel extends Node2D {
  static readonly W = 200
  static readonly H = 120
  readonly #index: number
  readonly #trace = new Float32Array(128)
  #t: number
  constructor(index: number) {
    super()
    this.#index = index
    this.#t = index * 0.5
  }
  onUpdate(dt: number): void {
    this.#t += dt
  }
  override draw(gfx: Gfx2D): void {
    this.face(gfx)
  }
  protected face(gfx: FaceSurface): void {
    const t = this.#t
    const W = Panel.W
    const v = 0.5 + 0.5 * Math.sin(t * 2)
    gfx.fillRoundRect(0, 0, W, Panel.H, 8, '#16202e')
    gfx.strokeRoundRect(0, 0, W, Panel.H, 8, { color: '#4a5d7a', width: 1 })
    gfx.fillText(`Node ${this.#index + 1}`, 10, 16, {
      font: 'bold 12px monospace',
      color: '#cfe0ff',
      baseline: 'middle',
    })
    gfx.fillText(`${(v * 100).toFixed(1)}%`, W - 10, 16, {
      font: '12px monospace',
      color: '#9fe0a8',
      align: 'right',
      baseline: 'middle',
    })
    gfx.fillText(`queue ${Math.floor(v * 40)}`, 10, 36, {
      font: '11px monospace',
      color: '#8aa0c0',
    })
    gfx.fillRoundRect(10, 46, W - 20, 8, 4, '#2a3a52')
    gfx.fillRoundRect(10, 46, (W - 20) * v, 8, 4, hue(this.#index * 40))
    const pts = this.#trace
    for (let k = 0; k < 64; k++) {
      pts[k * 2] = 10 + (k * (W - 20)) / 63
      pts[k * 2 + 1] = 95 - 25 * Math.sin(t * 3 + k * 0.2)
    }
    gfx.strokePolyline(pts, 64, { color: '#7fd0ff', width: 1.5 })
  }
}

/** The same panel, recorded again every frame. */
class PaintPanel extends Panel {
  override paint(canvas: Canvas): void {
    this.face(canvas)
  }
  override onUpdate(dt: number): void {
    super.onUpdate(dt)
    this.markNeedsPaint()
  }
}

/** Lay `n` panels out in a grid that fits the view. */
function placePanels(
  scene: SceneTree,
  n: number,
  make: (index: number) => Panel,
): void {
  const cells = tile(n, Panel.W + 16, Panel.H + 16)
  for (let i = 0; i < n; i++) {
    const node = make(i)
    const { x, y, scale } = cells[i]
    node.transform.x = x + 8 * scale
    node.transform.y = y + 8 * scale
    node.transform.scaleX = scale
    node.transform.scaleY = scale
    scene.root.add(node)
  }
}

/**
 * A panel laid out in CSS pixels, so every size is multiplied by the world size
 * of a pixel and has to follow the camera when it zooms.
 */
class ScreenPanel extends Node2D {
  readonly #index: number
  constructor(index: number) {
    super()
    this.#index = index
  }
  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    this.face(gfx, camera.strokeSpaceScale())
  }
  protected face(gfx: FaceSurface, s: number): void {
    const W = 180 * s
    const H = 100 * s
    gfx.fillRoundRect(0, 0, W, H, 8 * s, '#16202e')
    gfx.strokeRoundRect(0, 0, W, H, 8 * s, { color: '#4a5d7a', width: 1 * s })
    gfx.fillText(`Node ${this.#index + 1}`, 10 * s, 16 * s, {
      font: `bold ${12 * s}px monospace`,
      color: '#cfe0ff',
      baseline: 'middle',
    })
    gfx.fillRoundRect(10 * s, 34 * s, W - 20 * s, 8 * s, 4 * s, '#2a3a52')
    gfx.fillRoundRect(
      10 * s,
      34 * s,
      (W - 20 * s) * 0.6,
      8 * s,
      4 * s,
      hue(this.#index * 40),
    )
    gfx.fillRoundRect(10 * s, 52 * s, 60 * s, 30 * s, 6 * s, '#3a4d6a')
    gfx.fillCircle(W - 30 * s, 66 * s, 14 * s, hue(this.#index * 40 + 90))
  }
}

/** The same panel, painted into a picture that depends on the screen scale. */
class PaintScreenPanel extends ScreenPanel {
  override paint(canvas: Canvas): void {
    this.face(canvas, canvas.screenScale())
  }
}

/** Zooms the 2D camera in and out around the bench view every frame. */
class ZoomDriver extends Node2D {
  #t = 0
  onUpdate(dt: number): void {
    this.#t += dt
    const k = 1 + 0.25 * Math.sin(this.#t * 1.2)
    const w = VIEW.width / k
    const h = VIEW.height / k
    this.engine?.currentCamera2D?.setViewport({
      x: (VIEW.width - w) / 2,
      y: (VIEW.height - h) / 2,
      width: w,
      height: h,
    })
  }
}

/** Lay `n` screen panels out in a grid and add the zoom driver. */
function placeScreenPanels(
  scene: SceneTree,
  n: number,
  make: (index: number) => ScreenPanel,
): void {
  const cells = tile(n, 196, 116)
  for (let i = 0; i < n; i++) {
    const node = make(i)
    const { x, y, scale } = cells[i]
    node.transform.x = x + 8 * scale
    node.transform.y = y + 8 * scale
    node.transform.scaleX = scale
    node.transform.scaleY = scale
    scene.root.add(node)
  }
  scene.root.add(new ZoomDriver())
}

/**
 * Stripes clipped to a rounded rect or a circle, in a node that is rotated and
 * scaled unevenly. The clip lives in the node's local space, so it turns and
 * stretches with the node.
 */
class ClipTile extends Node2D {
  readonly #index: number
  constructor(index: number) {
    super()
    this.#index = index
  }
  override paint(canvas: Canvas): void {
    if (this.#index % 2 === 0) {
      canvas.setClip({
        kind: 'roundRect',
        x: -60,
        y: -30,
        w: 120,
        h: 60,
        radius: 14,
      })
    } else {
      canvas.setClip({ kind: 'circle', cx: 0, cy: 0, r: 40 })
    }
    for (let k = -6; k < 6; k++) {
      canvas.fillRect(-70, k * 12 + 3, 140, 6, hue(this.#index * 50 + k * 20))
    }
    canvas.setClip(null)
  }
}

/**
 * A large field of cells redrawn every frame, where a few cells change each
 * frame and fade in, as in a board that reveals regions over time.
 */
class CellField extends Node2D {
  readonly #cols: number
  readonly #rows: number
  readonly #cell: number
  readonly #alpha: Float32Array
  readonly #rand = seeded(7)
  constructor(cols: number) {
    super()
    this.#cols = cols
    this.#rows = Math.round((cols * 9) / 16)
    this.#cell = VIEW.width / cols
    this.#alpha = new Float32Array(this.#cols * this.#rows)
  }
  onUpdate(dt: number): void {
    const a = this.#alpha
    for (let k = 0; k < 20; k++) {
      const idx = Math.floor(this.#rand() * a.length)
      if (a[idx] === 0) a[idx] = 0.01
    }
    for (let k = 0; k < a.length; k++) {
      if (a[k] > 0 && a[k] < 1) a[k] = Math.min(1, a[k] + dt * 2)
    }
    // Start over once the field fills up, so the scene does not settle.
    let filled = 0
    for (let k = 0; k < a.length; k++) if (a[k] > 0) filled++
    if (filled > a.length * 0.9) a.fill(0)
  }
  override draw(gfx: Gfx2D): void {
    const c = this.#cell
    gfx.fillRect(0, 0, this.#cols * c, this.#rows * c, '#14202e')
    const a = this.#alpha
    for (let y = 0; y < this.#rows; y++) {
      for (let x = 0; x < this.#cols; x++) {
        const v = a[y * this.#cols + x]
        if (v === 0) continue
        gfx.setAlpha(v)
        gfx.fillRect(x * c, y * c, c, c, '#3f7fbf')
      }
    }
    gfx.setAlpha(1)
    const line = { color: '#26384d', width: 1 }
    for (let x = 0; x <= this.#cols; x++)
      gfx.strokeLine(x * c, 0, x * c, this.#rows * c, line)
    for (let y = 0; y <= this.#rows; y++)
      gfx.strokeLine(0, y * c, this.#cols * c, y * c, line)
  }
}

/** A large translucent star that turns slowly, so most pixels are filled. */
class BigStar extends Node2D {
  static #path: GfxPath | null = null
  readonly #color: string
  readonly #speed: number
  constructor(index: number) {
    super()
    this.#color = hue(index * 61)
    this.#speed = 0.1 + (index % 5) * 0.05
    this.transform.x = VIEW.width / 2 + ((index % 4) - 1.5) * 120
    this.transform.y = VIEW.height / 2 + ((index % 3) - 1) * 100
  }
  static path(): GfxPath {
    if (!BigStar.#path) {
      const p = new GfxPath()
      const points = 12
      for (let k = 0; k < points * 2; k++) {
        const r = k % 2 === 0 ? 900 : 380
        const a = (k / (points * 2)) * Math.PI * 2
        if (k === 0) p.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        else p.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      p.close()
      BigStar.#path = p
    }
    return BigStar.#path
  }
  onUpdate(dt: number): void {
    this.transform.rotation += dt * this.#speed
  }
  override draw(gfx: Gfx2D): void {
    gfx.setAlpha(0.18)
    gfx.fillPath(BigStar.path(), this.#color, 'nonzero')
    gfx.setAlpha(1)
  }
}

class Spinner3D extends MeshNode {
  #t = 0
  readonly #speed: number
  constructor(index: number, color: [number, number, number, number]) {
    super(createBoxGeometry(1), {
      lit: true,
      pbr: true,
      color,
      metallicFactor: 0,
      roughnessFactor: 0.6,
    })
    this.#speed = 0.4 + (index % 7) * 0.1
    this.#t = index
  }
  onUpdate(dt: number): void {
    this.#t += dt * this.#speed
    const q = quatFromAxisAngle(quat(), 0, 1, 0, this.#t)
    this.transform.setRotation(q.x, q.y, q.z, q.w)
  }
}

const lottieFixtures = import.meta.glob('./fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const lottieCache = new Map<string, LottieAnimation>()
function lottieFixture(path: string): LottieAnimation {
  let anim = lottieCache.get(path)
  if (!anim) {
    anim = parseLottie(lottieFixtures[path])
    lottieCache.set(path, anim)
  }
  return anim
}

/** The fixture path for `name`, or the `&file=` parameter when `name` is unset. */
export function lottiePath(name?: string): string {
  const file =
    name ??
    new URLSearchParams(window.location.search).get('file') ??
    'isometric'
  const path = `./fixtures/lottie/${file}.json`
  if (!(path in lottieFixtures))
    throw new Error(`bench: unknown file '${file}'`)
  return path
}

/** Tile `n` animations over the view. */
function lottieTiles(
  scene: SceneTree,
  n: number,
  pick: (i: number) => string,
  stagger: boolean,
): void {
  const cells = tile(n, 1, 1)
  for (let i = 0; i < n; i++) {
    const anim = lottieFixture(pick(i))
    const { x, y, scale } = cells[i]
    const node = new LottieNode({
      animation: anim,
      width: scale,
      height: scale,
    })
    node.transform.x = x
    node.transform.y = y
    if (stagger) node.seek((i * 7) % Math.max(1, anim.totalFrames - 1))
    scene.root.add(node)
  }
}

/** The Lottie file a scene uses, set by the suite for each case. */
export const lottieChoice: { file?: string } = {}

/** Lay `n` cards out in a grid that fits the view. */
function placeCards(
  scene: SceneTree,
  n: number,
  make: (index: number) => Card,
): void {
  const cells = tile(n, Card.W + 20, Card.H + 20)
  for (let i = 0; i < n; i++) {
    const node = make(i)
    const { x, y, scale } = cells[i]
    node.transform.x = x + 10 * scale
    node.transform.y = y + 10 * scale
    node.transform.scaleX = scale
    node.transform.scaleY = scale
    scene.root.add(node)
  }
}

export const benchScenes: Record<string, BenchScene> = {
  // Nothing to draw. Its frame time is the display's refresh interval.
  idle: { build() {} },

  // Small fills with alternating blend, so every fill is its own run.
  rects: {
    build(scene, n) {
      for (let i = 0; i < n; i++) {
        const node = new BlendRect(hue(i * 37), i % 2 === 1)
        node.transform.x = (i % 100) * 18
        node.transform.y = Math.floor(i / 100) * 18
        scene.root.add(node)
      }
    },
  },

  // Small circles that share one instanced batch.
  circles: {
    build(scene, n) {
      for (let i = 0; i < n; i++) {
        const node = new ShapeNode({
          geometry: { kind: 'circle', radius: 6 },
          fill: hue(i * 53),
        })
        node.transform.x = (i % 160) * 12 + 6
        node.transform.y = (Math.floor(i / 160) * 12 + 6) % VIEW.height
        scene.root.add(node)
      }
    },
  },

  // Static text labels, each its own string.
  labels: {
    build(scene, n) {
      const cells = tile(n, 160, 28)
      for (let i = 0; i < n; i++) {
        const node = new Label(`Label number ${i}`, hue(i * 23))
        node.transform.x = cells[i].x
        node.transform.y = cells[i].y + 20
        scene.root.add(node)
      }
    },
  },

  // The same labels under a parent whose scale keeps changing, so their
  // rasters are regenerated as they cross scale buckets.
  'labels-zoom': {
    build(scene, n) {
      const parent = new Breathing()
      parent.transform.x = VIEW.width / 2
      parent.transform.y = VIEW.height / 2
      scene.root.add(parent)
      const cells = tile(n, 160, 28)
      for (let i = 0; i < n; i++) {
        const node = new Label(`Label number ${i}`, hue(i * 23))
        node.transform.x = cells[i].x - VIEW.width / 2
        node.transform.y = cells[i].y + 20 - VIEW.height / 2
        parent.add(node)
      }
    },
  },

  // Small images from 32 different sources, interleaved, so neighbouring draws
  // use different textures.
  images: {
    build(scene, n) {
      const set = icons()
      const cells = tile(n, 40, 40)
      for (let i = 0; i < n; i++) {
        const node = new Icon(set[(i * 7) % set.length])
        node.transform.x = cells[i].x
        node.transform.y = cells[i].y
        scene.root.add(node)
      }
    },
  },

  // Card faces, a third of them flipping.
  cards: {
    build(scene, n) {
      placeCards(scene, n, (i) => new Card(i))
    },
  },

  // The same cards painted into pictures: recorded once, then replayed.
  'cards-paint': {
    build(scene, n) {
      placeCards(scene, n, (i) => new PaintCard(i))
    },
  },

  // The same cards painted again every frame, to measure what recording costs
  // against drawing straight into the renderer.
  'cards-repaint': {
    build(scene, n) {
      placeCards(scene, n, (i) => new RepaintCard(i))
    },
  },

  // A blurred layer that never changes, drawn every frame and drawn from its
  // kept render, and the same with 500 rects so the cost of checking that
  // nothing changed shows.
  'layer-blur': {
    build(scene, n) {
      blurredLayer(scene, n, 'none')
    },
  },
  'layer-blur-cached': {
    build(scene, n) {
      blurredLayer(scene, n, 'raster')
    },
  },
  'layer-plain': {
    build(scene, n) {
      plainLayer(scene, n, 'none')
    },
  },
  'layer-plain-cached': {
    build(scene, n) {
      plainLayer(scene, n, 'raster')
    },
  },

  // Panels whose content changes every frame, drawn directly.
  panels: {
    build(scene, n) {
      placePanels(scene, n, (i) => new Panel(i))
    },
  },

  // The same panels recorded again every frame, as production nodes that
  // cannot rest would do.
  'panels-paint': {
    build(scene, n) {
      placePanels(scene, n, (i) => new PaintPanel(i))
    },
  },

  // Panels sized in CSS pixels under a camera that zooms every frame, drawn
  // directly.
  zoom: {
    build(scene, n) {
      placeScreenPanels(scene, n, (i) => new ScreenPanel(i))
    },
  },

  // The same panels painted into pictures that depend on the screen scale, so
  // every frame of the zoom repaints them all.
  'zoom-paint': {
    build(scene, n) {
      placeScreenPanels(scene, n, (i) => new PaintScreenPanel(i))
    },
  },

  // Clipped stripes under rotation and uneven scale, for checking that a clip
  // follows its node's transform.
  clips: {
    build(scene, n) {
      const cells = tile(n, 180, 120)
      for (let i = 0; i < n; i++) {
        const node = new ClipTile(i)
        const { x, y, scale } = cells[i]
        node.transform.x = x + 90 * scale
        node.transform.y = y + 60 * scale
        node.transform.rotation = (i * Math.PI) / 7
        node.transform.scaleX = scale * (i % 3 === 2 ? 1.5 : 1)
        node.transform.scaleY = scale * (i % 3 === 1 ? 0.6 : 1)
        scene.root.add(node)
      }
    },
  },

  // A grid `n` cells wide, with cells fading in a few at a time.
  grid: {
    build(scene, n) {
      scene.root.add(new CellField(n))
    },
  },

  // `n` large translucent stars over the whole view, filled with the stencil
  // path. Measures fill rate, so its cost grows with the screen's pixel count.
  fill: {
    build(scene, n) {
      for (let i = 0; i < n; i++) scene.root.add(new BigStar(i))
    },
  },

  // An `n` x `n` grid of turning boxes on a ground plane, with a shadowing sun
  // and ambient occlusion.
  boxes3d: {
    camera2D: false,
    host: {
      fog: { enabled: false },
      quality: {
        meshShadowsEnabled: true,
        shadowMapSize: 2048,
        shadowSoftness: 9,
      },
    },
    after(host) {
      host.engine.ambientOcclusion.enabled = true
    },
    build(scene, n, canvas) {
      const root = scene.root
      const ground = new MeshNode(createBoxGeometry(1), {
        lit: true,
        pbr: true,
        color: [0.5, 0.5, 0.5, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      })
      ground.transform.setScale(n * 2 + 4, 0.2, n * 2 + 4)
      ground.transform.setPosition(0, -0.1, 0)
      root.add(ground)
      for (let i = 0; i < n * n; i++) {
        const gx = (i % n) - (n - 1) / 2
        const gz = Math.floor(i / n) - (n - 1) / 2
        const c = i / (n * n)
        const box = new Spinner3D(i, [0.3 + 0.6 * c, 0.4, 0.9 - 0.6 * c, 1])
        box.transform.setPosition(gx * 2, 0.6, gz * 2)
        root.add(box)
      }
      const camera = new CameraNode3D()
      camera.transform.setPosition(0, n * 1.2 + 2, n * 1.8 + 4)
      const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -0.55)
      camera.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)
      camera.setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight))
      root.add(camera)
      camera.makeCurrent()
      const sun = new DirectionalLight3D({
        color: [1, 0.97, 0.92],
        intensity: 2.4,
        shadowEnabled: true,
        shadowNormalBias: 2,
      })
      const aim = quatFromAxisAngle(quat(), 1, 0, 0, -1.1)
      sun.transform.setRotation(aim.x, aim.y, aim.z, aim.w)
      root.add(sun)
    },
  },

  // Lottie scenes read the file from `lottieChoice` or `&file=`.
  'lottie-hero': {
    build(scene) {
      const node = new LottieNode({
        animation: lottieFixture(lottiePath(lottieChoice.file)),
        width: VIEW.width,
        height: VIEW.height,
      })
      scene.root.add(node)
    },
  },
  'lottie-grid': {
    build(scene, n) {
      const path = lottiePath(lottieChoice.file)
      lottieTiles(scene, n, () => path, false)
    },
  },
  'lottie-stagger': {
    build(scene, n) {
      const path = lottiePath(lottieChoice.file)
      lottieTiles(scene, n, () => path, true)
    },
  },
  'lottie-mixed': {
    build(scene, n) {
      const paths = Object.keys(lottieFixtures).sort()
      lottieTiles(scene, n, (i) => paths[i % paths.length], true)
    },
  },
}

/** Adds the 2D camera every 2D scene lays out against. */
export function addBenchCamera(scene: SceneTree): void {
  addDemoCamera(scene, VIEW)
}
