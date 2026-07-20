import { SceneNode, type Camera, type Gfx2D, type Rect } from '@src/stargazer'
import { REGION_HEIGHT, REGION_WIDTH, layout } from '../world'
import type { RadialDef, SkyPalette } from './palette'
import { StopsCache, visibleWorldRect } from './util'
import type { PaletteSource } from './BackgroundController'

export interface CloudOptions {
  /** Cloud silhouette texture (alpha = mask). Uploaded once, moved per frame. */
  bitmap: ImageBitmap
  /** Draw size in world units. */
  drawW: number
  drawH: number
  /** Distance of the cloud's BOTTOM above the world bottom (world units). */
  bottomOffset: number
  /** Horizontal spacing between repeated copies (world units). */
  period: number
  /** Drift direction: +1 = left→right, -1 = right→left. */
  dir: 1 | -1
  /** Drift speed (world units / sec). */
  speed: number
  /** Picks this cloud's radial gradient from the palette. */
  pick: (p: SkyPalette) => RadialDef
}

/**
 * A cloud layer: the silhouette texture tiled across the visible width and
 * drifting horizontally, revealing a WORLD-FIXED radial gradient — the glow
 * stays put in the scene and the clouds sweep through it, lighting up as they
 * cross and fading as they leave. Zero per-frame texture uploads.
 */
export class CloudNode extends SceneNode {
  readonly #source: PaletteSource
  readonly #opts: CloudOptions
  /** Accumulated drift, wrapped into `[0, period)`. */
  #scroll = 0
  readonly #stops = new StopsCache()
  readonly #vr: Rect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(source: PaletteSource, opts: CloudOptions) {
    super('cloud')
    this.#source = source
    this.#opts = opts
    this.renderLayer = 'dynamic'
  }

  override onUpdate(dt: number): void {
    const period = this.#opts.period
    this.#scroll += this.#opts.speed * this.#opts.dir * dt
    this.#scroll = ((this.#scroll % period) + period) % period
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const { bitmap, drawW, drawH, bottomOffset, period } = this.#opts
    const def = this.#opts.pick(this.#source.palette)
    const stops = this.#stops.get(this.#source.version, def.stops)
    const vr = visibleWorldRect(camera, this.#vr)

    // Bottom-aligned to the world (launcher region) bottom, read live so a
    // resize (which moves the launcher region) re-flows.
    const centerY = layout.worldHeight - drawH / 2 - bottomOffset

    // World-fixed gradient (launcher-region coords) — same for every copy, so
    // the glow stays put while clouds drift through it.
    const gcx = REGION_WIDTH * def.cx
    const gcy = layout.launcherTop + REGION_HEIGHT * def.cy
    const gr = REGION_WIDTH * def.r

    // Tile copies across the visible width (+ a cloud on each side so one is
    // always entering as another leaves).
    const left = vr.x - drawW
    const right = vr.x + vr.width + drawW
    const kStart = Math.floor((left - this.#scroll) / period)
    const kEnd = Math.ceil((right - this.#scroll) / period)
    const dstY = centerY - drawH / 2
    for (let k = kStart; k <= kEnd; k++) {
      const cx = this.#scroll + k * period
      const dstX = cx - drawW / 2
      gfx.fillMaskedRadialGradient(
        bitmap,
        dstX,
        dstY,
        drawW,
        drawH,
        gcx,
        gcy,
        gr,
        stops,
      )
    }
  }
}
