import { get } from 'svelte/store'
import { Node2D, type EngineHost } from '@src/stargazer'
import { daemonConfig } from '@src/stores/daemonConfig'
import cloudUrl from '../assets/arcade-cloud.svg?url'
import { REGION_HEIGHT } from '../world'
import { publishSky } from '../uiState'
import { type SkyPalette } from './palette'
import {
  DAY_CYCLE,
  effectiveElevationDeg,
  locationFromConfig,
  paletteAt,
} from './dayCycle'
import { SkyGradientNode } from './SkyGradientNode'
import { OceanNode } from './OceanNode'
import { CloudNode } from './CloudNode'

/** Read-only view of the live palette + a version bumped whenever it changes. */
export interface PaletteSource {
  readonly palette: SkyPalette
  readonly version: number
}

/** Native aspect of arcade-cloud.svg (3052×1028). */
const CLOUD_ASPECT = 3052 / 1028

/**
 * Loads the cloud silhouette as a straight-alpha `ImageBitmap` (only the alpha
 * channel is sampled by the shader, so `premultiplyAlpha:'none'` avoids dark
 * edge halos).
 */
async function loadCloudBitmap(): Promise<ImageBitmap> {
  const img = new Image()
  img.src = cloudUrl
  await img.decode()
  return createImageBitmap(img, { premultiplyAlpha: 'none' })
}

/**
 * Owns the persistent, world-anchored background (sky + ocean + two drifting
 * clouds) and the live sky palette. Built once at boot, survives across game
 * mounts. A timer walks the palette through the day, see `dayCycle.ts`.
 */
export class BackgroundController implements PaletteSource {
  palette: SkyPalette
  version = 0

  readonly #group = new Node2D('background')
  readonly #host: EngineHost
  #timer: ReturnType<typeof setInterval> | null = null
  #lastDrive: number | null = null
  #sunOverrideDeg: number | null

  constructor(host: EngineHost, sunOverrideDeg: number | null = null) {
    this.#host = host
    // Assign the field rather than the accessor, which repaints and would read
    // `palette` before it exists.
    this.#sunOverrideDeg = sunOverrideDeg
    this.palette = paletteAt(this.#driveDeg())
  }

  /**
   * Freeze the cycle at an effective sun elevation, or `null` to follow the
   * clock. Both the dev URL params and the attendant slider route through
   * here.
   *
   * Writing repaints at once instead of waiting for the next tick, so dragging
   * the slider tracks the drag.
   */
  get sunOverrideDeg(): number | null {
    return this.#sunOverrideDeg
  }

  set sunOverrideDeg(deg: number | null) {
    if (deg === this.#sunOverrideDeg) return
    this.#sunOverrideDeg = deg
    this.#applyPalette()
  }

  /** Where the sun is right now, or wherever an override has pinned it. */
  #driveDeg(): number {
    if (this.#sunOverrideDeg !== null) return this.#sunOverrideDeg
    return effectiveElevationDeg(
      Date.now(),
      locationFromConfig(get(daemonConfig)),
    )
  }

  /**
   * Re-evaluate the palette. Skips the write when the sun has not moved and
   * when the driver is still inside a plateau, where `paletteAt` hands back the
   * same palette object. That keeps the gradient LUT upload-once at rest.
   */
  #applyPalette(): void {
    const drive = this.#driveDeg()
    if (this.#lastDrive === drive) return
    this.#lastDrive = drive
    const next = paletteAt(drive)
    if (next !== this.palette) {
      this.palette = next
      this.version++
    }
    publishSky(next, drive)
  }

  /** Load assets + attach the background subtree to the scene root. */
  async build(): Promise<void> {
    const bitmap = await loadCloudBitmap()

    // Draw order (back → front): sky, clouds, ocean. The clouds sit BEHIND the
    // ocean so they rise from behind the waterline.
    this.#group.add(new SkyGradientNode(this))

    const drawH = REGION_HEIGHT * 0.7
    const drawW = drawH * CLOUD_ASPECT
    // Bottom-aligned to the world bottom (cloud bottom ≈ world bottom).
    // Cloud 1: lower layer, drifts right, tiled across the width.
    this.#group.add(
      new CloudNode(this, {
        bitmap,
        drawW,
        drawH,
        bottomOffset: 0,
        period: drawW,
        dir: 1,
        speed: 26,
        pick: (p) => p.cloud1,
      }),
    )
    // Cloud 2: slightly higher layer, drifts left.
    this.#group.add(
      new CloudNode(this, {
        bitmap,
        drawW,
        drawH,
        bottomOffset: REGION_HEIGHT * 0.08,
        period: drawW,
        dir: -1,
        speed: 20,
        pick: (p) => p.cloud2,
      }),
    )

    // Ocean last within the background group → in front of the clouds.
    this.#group.add(new OceanNode(this))

    // The whole background group is added first to the scene root, so it draws
    // behind any game subtree added later.
    this.#host.engine.tree.root.add(this.#group)

    // A wall-clock timer rather than the engine ticker. Reading absolute time
    // lands on the right color after a pause or a stall, and ticking this
    // slowly keeps the cloud gradient LUT from being rebuilt every frame.
    publishSky(this.palette, this.#lastDrive ?? this.#driveDeg())
    this.#timer = setInterval(
      () => this.#applyPalette(),
      DAY_CYCLE.updateSeconds * 1000,
    )
  }

  /**
   * Show or hide the whole background.
   *
   * A 3D game takes this down while it plays, because the depth-tested 3D pass
   * runs before every 2D layer and the sky would cover its scene outright. The
   * arcade restores it when the game exits, see `ArcadeBackdrop`.
   *
   * Every child is set, not just the group. The 2D renderer flattens the tree
   * into per-layer lists and tests `visible` on each node it reaches, so a
   * hidden parent keeps its children drawing. Hiding the group alone would look
   * right in the scene tree and change nothing on screen.
   */
  setVisible(visible: boolean): void {
    this.#group.visible = visible
    for (const child of this.#group.children) child.visible = visible
  }

  destroy(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
    if (!this.#group.isDestroyed) this.#group.destroy()
  }
}
