import { Node3D } from '../scene/Node3D'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { Camera } from '../camera/Camera'
import { GpuGfx } from '../render/gfx/GpuGfx'
import { StageLayerRenderer } from '../render/StageLayerRenderer'
import type { GfxDevice, Texture } from '../render/gfx/GfxDevice'
import type { TextureInspector } from '../render/gfx/TextureManager'
import type { Renderer } from '../render/Renderer'
import type { Rect } from '../math/Rect'

/**
 * Options for a {@link Viewport2DNode}.
 *
 * @category Scene
 */
export interface Viewport2DOptions {
  /** Offscreen resolution in pixels. Higher is sharper under close/steep views. */
  width: number
  height: number
  /**
   * World rect the offscreen 2D camera frames. Defaults to `0,0,width,height`
   * (one world unit per pixel).
   */
  viewport?: Rect
  /** Clear color when `transparent` is false. */
  clearColor?: string
  /**
   * Leave the surface transparent so the 3D scene shows through the 2D
   * content's empty areas. Default `true`.
   */
  transparent?: boolean
}

const LAYERS = ['static', 'above-static', 'dynamic'] as const

/**
 * A 2D scene rendered to a texture and shown on a transformable quad in the 3D
 * world, the bridge for putting stargazer's 2D content (shapes, text, sprites)
 * into a 3D scene. Build the 2D content under
 * {@link Viewport2DNode.scene}`.root` exactly as for a normal stage; the 3D pass
 * renders it to an offscreen target each frame and draws it on a unit quad that
 * this node's `Transform3D` places, orients, and scales.
 *
 * The quad starts scaled to the surface's aspect ratio (width:height), so 2D
 * content isn't stretched; override `transform.scale` to resize it. The 2D
 * content is a raster snapshot at `width`×`height`; raise the resolution for
 * sharper results under extreme perspective.
 *
 * Display only: pointer input does not route into the embedded 2D tree. Each
 * surface is a separate offscreen render, so use them sparingly. GPU resources
 * are released when the owning stage is disposed.
 *
 * @category Scene
 * @example
 *   const panel = new Viewport2DNode({ width: 512, height: 256 })
 *   panel.scene.root.add(
 *     new ShapeNode({
 *       geometry: { kind: 'rect', width: 512, height: 256 },
 *       fill: '#123',
 *     }),
 *   )
 *   panel.transform.setPosition(0, 1, -3)
 *   engine.tree.add(panel)
 */
export class Viewport2DNode extends Node3D {
  /** The embedded 2D scene. Add 2D content under `scene.root`. */
  readonly scene: SceneTree
  /** The 2D camera framing the offscreen surface. */
  readonly camera: Camera

  readonly #width: number
  readonly #height: number
  readonly #clearColor: string
  readonly #transparent: boolean
  readonly #layerRenderer = new StageLayerRenderer()
  #gpu: GpuGfx | null = null

  constructor(opts: Viewport2DOptions, id?: string) {
    super(id)
    this.#width = opts.width
    this.#height = opts.height
    this.#clearColor = opts.clearColor ?? '#000000'
    this.#transparent = opts.transparent ?? true
    const viewport = opts.viewport ?? {
      x: 0,
      y: 0,
      width: opts.width,
      height: opts.height,
    }
    this.scene = new SceneTree(new Node2D('scene-root'))
    this.camera = new Camera(viewport, { w: opts.width, h: opts.height })
    // Start the quad aspect-correct so square 2D pixels aren't stretched.
    this.transform.setScale(opts.width / opts.height, 1, 1)
  }

  /** The rendered 2D surface, or `null` before the first offscreen render. */
  get colorTexture(): Texture | null {
    return this.#gpu?.colorTexture ?? null
  }

  /**
   * The embedded surface's texture inspector (its own atlas, glyph label-page,
   * and per-source cache), or `null` before the first offscreen render. The
   * debug HUD lists it as a separate source; see `Stage.textureSources`.
   */
  get textureInspector(): TextureInspector | null {
    return this.#gpu?.textureInspector ?? null
  }

  protected override _onAttach(): void {
    // The embedded scene animates through the same engine as the 3D world.
    const engine = this.engine
    this.scene.engine = engine
    this.camera.engine = engine
  }

  /**
   * Render the embedded 2D scene into the offscreen target. The stage calls
   * this as a pre-pass before the main frame; the 3D pass then samples
   * {@link Viewport2DNode.colorTexture}. `canvas` is only used to construct the
   * offscreen surface (it never presents to it).
   */
  renderOffscreen(
    device: GfxDevice,
    canvas: HTMLCanvasElement,
    dt: number,
  ): void {
    if (!this.#gpu) {
      // samples: 1 so the target is a sampleable color texture; the 2D pipeline
      // is analytically anti-aliased, so it stays crisp without MSAA.
      this.#gpu = new GpuGfx(canvas, device, { samples: 1, present: false })
      this.#gpu.setInternalSize(this.#width, this.#height)
    }
    const gpu = this.#gpu
    const camera = this.camera
    camera.setPixelSize(this.#width, this.#height)
    const t = camera.getScreenTransform()
    if (t.scale <= 0) return

    gpu.beginFrame({
      clearColor: this.#clearColor,
      transparent: this.#transparent,
      pixelW: this.#width,
      pixelH: this.#height,
    })
    // The offscreen target is device-pixel-for-pixel (dpr 1), so the layer
    // renderer's base affine is the camera's screen affine directly.
    const rendererStub = {
      cssSize: { w: this.#width, h: this.#height },
    } as unknown as Renderer
    const render = camera.getScreenAffine()
    for (const layer of LAYERS) {
      this.#layerRenderer.drawLayer(
        this.scene,
        rendererStub,
        layer,
        gpu,
        camera,
        render,
        dt,
      )
      gpu.flush()
    }
    gpu.endFrame()
  }

  override destroy(): void {
    this.scene.root.destroy()
    super.destroy()
  }
}
