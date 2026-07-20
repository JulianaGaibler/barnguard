import { SceneNode, type EngineHost } from '@src/stargazer'
import cloudUrl from '../assets/arcade-cloud.svg?url'
import { REGION_HEIGHT } from '../world'
import { SUNSET, lerpPalette, type SkyPalette } from './palette'
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
 * clouds) and the live sky palette. Built once at boot; survives across game
 * mounts. `transitionTo` cross-lerps the palette for time-of-day changes.
 */
export class BackgroundController implements PaletteSource {
  palette: SkyPalette = SUNSET
  version = 0

  readonly #group = new SceneNode('background')
  #offFrame: (() => void) | null = null
  readonly #host: EngineHost

  constructor(host: EngineHost) {
    this.#host = host
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
    this.#host.engine.scene.root.add(this.#group)
  }

  /** Cross-lerp the palette to `next` over `seconds` (time-of-day changes). */
  transitionTo(next: SkyPalette, seconds: number): void {
    const from = this.palette
    let elapsed = 0
    this.#offFrame?.()
    this.#offFrame = this.#host.engine.ticker.onFrame((dt) => {
      elapsed += dt
      const t = seconds <= 0 ? 1 : Math.min(1, elapsed / seconds)
      this.palette = lerpPalette(from, next, t)
      this.version++
      if (t >= 1) {
        this.#offFrame?.()
        this.#offFrame = null
      }
    })
  }

  destroy(): void {
    this.#offFrame?.()
    this.#offFrame = null
    if (!this.#group.isDestroyed) this.#group.destroy()
  }
}
