/**
 * Renders a scene to an image outside the frame loop, for {@link Engine.capture}
 * and {@link Engine.captureBlob}.
 *
 * Every capture goes through one secondary stage on a canvas that is never in
 * the document. The stage is created on the first capture, reused by the ones
 * after it, and detached once captures stop for
 * {@link CAPTURE_IDLE_RELEASE_SEC}, so capturing costs at most one extra GPU
 * context. The stage is inactive, so the frame loop never draws it. Each
 * capture renders it directly instead, which also works while the loop is
 * stopped.
 *
 * Captures run one at a time, in call order, since they share the stage.
 */
import type { Stage, StageOptions } from '../render/Stage'
import type { GfxDevice } from '../render/gfx/GfxDevice'
import type { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { CameraNode2D } from '../camera/CameraNode2D'
import { copyCanvas } from './captureCopy'

/** Seconds without a capture before the capture stage and its context go. */
export const CAPTURE_IDLE_RELEASE_SEC = 30

/** Pipeline warm-ups and effect compiles a capture waits through, at most. */
const MAX_WARMUPS = 3

export interface CaptureOptions {
  /** Image width in pixels. */
  width: number
  /** Image height in pixels. */
  height: number
  /**
   * Add the scene to `root`. One scene unit is one pixel, with the origin at
   * the top left. May be async to load assets first. The nodes are destroyed
   * once the image is taken.
   */
  build(root: Node2D): void | Promise<void>
  /** Background color. Without one the background is transparent. */
  clearColor?: string
  /**
   * Frames rendered before the image is taken. Default 2. The first frame of a
   * new scene bakes path shadow masks and uploads new text rasters and gradient
   * ramps, drawing stand-ins where they are not ready yet, so the second frame
   * is the first that shows them all.
   */
  settleFrames?: number
  /**
   * Test-only: the `GfxDevice` for the capture stage, used when the stage is
   * created. See {@link StageOptions.gpuDevice}. Not for app code.
   */
  gpuDevice?: GfxDevice
}

export interface CaptureBlobOptions extends CaptureOptions {
  /** Image MIME type. Default `'image/png'`. */
  type?: string
  /** Encoder quality from 0 to 1, for lossy types such as `'image/jpeg'`. */
  quality?: number
}

/** The engine side a capture needs. */
export interface CaptureHost {
  attachStage(canvas: HTMLCanvasElement, opts: StageOptions): Stage
  detachStage(stage: Stage): void
  /** Run the dirty layout roots in `tree`. */
  runLayout(tree: SceneTree): void
}

export class SceneCapture {
  readonly #host: CaptureHost
  #stage: Stage | null = null
  #camera: CameraNode2D | null = null
  #queue: Promise<unknown> = Promise.resolve()
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  constructor(host: CaptureHost) {
    this.#host = host
  }

  /** The capture stage while it is alive, for inspection and tests. */
  get stage(): Stage | null {
    return this.#stage
  }

  capture(opts: CaptureOptions): Promise<ImageBitmap> {
    return this.#enqueue(opts, (surface) => surface.transferToImageBitmap())
  }

  captureBlob(opts: CaptureBlobOptions): Promise<Blob> {
    return this.#enqueue(opts, (surface) =>
      surface.convertToBlob({
        type: opts.type ?? 'image/png',
        quality: opts.quality,
      }),
    )
  }

  /** Detach the capture stage and refuse captures from now on. */
  dispose(): void {
    this.#disposed = true
    this.#release()
  }

  #enqueue<T>(
    opts: CaptureOptions,
    encode: (surface: OffscreenCanvas) => T | Promise<T>,
  ): Promise<T> {
    const run = this.#queue.then(() => this.#run(opts, encode))
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #run<T>(
    opts: CaptureOptions,
    encode: (surface: OffscreenCanvas) => T | Promise<T>,
  ): Promise<T> {
    if (this.#disposed) {
      throw new Error('stargazer: capture after engine.destroy()')
    }
    this.#cancelIdleRelease()
    const stage = this.#prepare(opts)
    const content = new Node2D('capture-content')
    stage.tree.root.add(content)
    try {
      await opts.build(content)
      await this.#settle(stage, opts.settleFrames ?? 2)
      // Same task as the last render, while the canvas still holds the frame.
      const surface = copyCanvas(stage.canvas, opts.width, opts.height)
      return await encode(surface)
    } catch (err) {
      this.#release()
      throw err
    } finally {
      if (!content.isDestroyed) content.destroy()
      if (this.#stage) this.#scheduleIdleRelease()
    }
  }

  /** The capture stage sized and framed for `opts`, created if needed. */
  #prepare(opts: CaptureOptions): Stage {
    const { width, height } = opts
    let stage = this.#stage
    let camera = this.#camera
    if (!stage || !camera) {
      const canvas = document.createElement('canvas')
      stage = this.#host.attachStage(canvas, {
        name: 'Capture',
        fixedPixelSize: { width, height },
        transparent: false,
        // Captures are separate stills, so text never holds a raster from the
        // previous capture's size.
        exactText: true,
        gpuDevice: opts.gpuDevice,
      })
      stage.setActive(false)
      camera = new CameraNode2D()
      stage.tree.root.add(camera)
      camera.makeCurrent()
      this.#stage = stage
      this.#camera = camera
    } else {
      stage.setFixedPixelSize(width, height)
    }
    camera.setViewport({ x: 0, y: 0, width, height })
    stage.renderer.transparent = opts.clearColor === undefined
    if (opts.clearColor !== undefined)
      stage.renderer.clearColor = opts.clearColor
    return stage
  }

  /**
   * Render `frames` frames once the pipelines are warm. A frame can start a new
   * warm-up, as turning on depth does, and `render` skips frames until it
   * finishes. A frame can also start compiling a layer's effects, and draws
   * that layer without them until they finish. Either way the frames run again
   * once the wait is over.
   */
  async #settle(stage: Stage, frames: number): Promise<void> {
    const count = Math.max(1, Math.floor(frames))
    for (let warmup = 0; warmup < MAX_WARMUPS; warmup++) {
      await stage.whenReady
      if (this.#stage !== stage) {
        throw new Error('stargazer: capture stage released mid-capture')
      }
      for (let i = 0; i < count; i++) {
        this.#host.runLayout(stage.tree)
        stage.updateTransforms()
        stage.render(0)
      }
      if (stage.faulted) throw new Error('stargazer: capture render faulted')
      if (!stage.ready) continue
      if (!stage.effectsCompiling) return
      await stage.whenEffectsCompiled()
    }
    throw new Error('stargazer: capture pipelines did not settle')
  }

  #scheduleIdleRelease(): void {
    this.#cancelIdleRelease()
    this.#idleTimer = setTimeout(
      () => this.#release(),
      CAPTURE_IDLE_RELEASE_SEC * 1000,
    )
  }

  #cancelIdleRelease(): void {
    if (this.#idleTimer === null) return
    clearTimeout(this.#idleTimer)
    this.#idleTimer = null
  }

  #release(): void {
    this.#cancelIdleRelease()
    const stage = this.#stage
    this.#stage = null
    this.#camera = null
    if (stage) this.#host.detachStage(stage)
  }
}
