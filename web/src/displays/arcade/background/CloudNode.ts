import { Node2D, definePaintProps, type Canvas } from '@src/stargazer'
import { REGION_HEIGHT, REGION_WIDTH, layout } from '../world'
import type { RadialDef, SkyPalette } from './palette'
import { StopsCache } from './util'
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
  /** Drift direction: +1 = left->right, -1 = right->left. */
  dir: 1 | -1
  /** Drift speed (world units / sec). */
  speed: number
  /** Picks this cloud's radial gradient from the palette. */
  pick: (p: SkyPalette) => RadialDef
}

/**
 * A cloud layer: the silhouette texture tiled across the visible width and
 * drifting horizontally, revealing a WORLD-FIXED radial gradient. The glow
 * stays put in the scene, and the clouds sweep through it, lighting up as they
 * cross and fading as they leave. Zero per-frame texture uploads. The drift is
 * the gradient's offset against the cloud, so the node paints again every
 * frame, a handful of masked gradient fills.
 */
export class CloudNode extends Node2D {
  readonly #source: PaletteSource
  readonly #opts: CloudOptions
  /** Accumulated drift, wrapped into `[0, period)`. */
  declare scroll: number
  readonly #stops = new StopsCache()

  constructor(source: PaletteSource, opts: CloudOptions) {
    super('cloud')
    this.#source = source
    this.#opts = opts
    definePaintProps(this, { scroll: 0 })
  }

  override onUpdate(dt: number): void {
    const period = this.#opts.period
    const next = this.scroll + this.#opts.speed * this.#opts.dir * dt
    this.scroll = ((next % period) + period) % period
  }

  override paint(gfx: Canvas): void {
    gfx.use(this.#source)
    const { bitmap, drawW, drawH, bottomOffset, period } = this.#opts
    const def = this.#opts.pick(this.#source.palette)
    const stops = this.#stops.get(this.#source.version, def.stops)
    const vr = gfx.visibleWorldRect()

    // Bottom-aligned to the world (launcher region) bottom, read live so a
    // resize (which moves the launcher region) re-flows.
    const centerY = layout.worldHeight - drawH / 2 - bottomOffset

    // World-fixed gradient (launcher-region coords), the same for every copy,
    // so the glow stays put while clouds drift through it.
    const gcx = REGION_WIDTH * def.cx
    const gcy = layout.launcherTop + REGION_HEIGHT * def.cy
    const gr = REGION_WIDTH * def.r

    // Tile copies across the visible width (+ a cloud on each side so one is
    // always entering as another leaves).
    const left = vr.x - drawW
    const right = vr.x + vr.width + drawW
    const kStart = Math.floor((left - this.scroll) / period)
    const kEnd = Math.ceil((right - this.scroll) / period)
    const dstY = centerY - drawH / 2
    for (let k = kStart; k <= kEnd; k++) {
      const cx = this.scroll + k * period
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
