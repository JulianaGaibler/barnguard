// Secondary-stage bookkeeping for `Engine`: the live Set, the
// attached-canvas guard, and stage construction/teardown. Split out because
// it's self-contained record-keeping, independent of the frame loop and
// lifecycle methods that stay on `Engine`.

import { Stage, type StageOptions } from '../render/Stage'
import type { Engine } from './Engine'

export class EngineStageManager {
  readonly #_stages = new Set<Stage>()
  readonly #_attachedCanvases = new WeakSet<HTMLCanvasElement>()
  // Unregister callbacks for secondary stages that own a physics world, so
  // `detachStage` can pull the world out of the engine's step loop.
  readonly #physicsUnregister = new Map<Stage, () => void>()

  constructor(primaryCanvas: HTMLCanvasElement) {
    this.#_attachedCanvases.add(primaryCanvas)
  }

  /** Read-only view of currently-attached secondary stages. */
  get stages(): ReadonlySet<Stage> {
    return this.#_stages
  }

  /**
   * Construct and register a secondary `Stage`. Throws if `canvas` is already
   * attached. The caller (`Engine.attachStage`) is responsible for the "engine
   * already destroyed" guard.
   */
  attachStage(
    engine: Engine,
    canvas: HTMLCanvasElement,
    opts: StageOptions,
  ): Stage {
    if (this.#_attachedCanvases.has(canvas)) {
      throw new Error(
        'stargazer: attachStage called with a canvas that is already attached',
      )
    }
    // Secondary stages default to transparent, the parent HTML card owns
    // the background.
    const stage = new Stage(canvas, engine, {
      initialViewport: opts.initialViewport,
      clearColor: opts.clearColor,
      transparent: opts.transparent ?? true,
      interactive: opts.interactive,
      name: opts.name,
      renderer: opts.renderer ?? engine.rendererMode,
      msaaSamples: opts.msaaSamples ?? engine.msaaSamples,
      onResize: opts.onResize,
    })
    this.#_stages.add(stage)
    this.#_attachedCanvases.add(canvas)
    if (stage.physics) {
      this.#physicsUnregister.set(
        stage,
        engine.registerPhysicsWorld(stage.physics, {
          spaceNode: stage.scene.root,
          label: stage.name ?? 'stage',
        }),
      )
    }
    return stage
  }

  /**
   * Detach and dispose a secondary stage. Cascades AbortErrors through its
   * scene. `onDetached` lets the caller notify the debug controller before
   * teardown; no-op if `stage` isn't currently attached.
   */
  detachStage(stage: Stage, onDetached?: (stage: Stage) => void): void {
    if (!this.#_stages.delete(stage)) return
    this.#physicsUnregister.get(stage)?.()
    this.#physicsUnregister.delete(stage)
    // `WeakSet.delete` isn't on all TS lib targets, cast to any. The GC will
    // reclaim the entry when the canvas element itself is collected either
    // way; explicit delete is only for the reattach-same-canvas case.
    ;(
      this.#_attachedCanvases as unknown as {
        delete(v: HTMLCanvasElement): boolean
      }
    ).delete(stage.canvas)
    onDetached?.(stage)
    stage.dispose()
  }

  /** Dispose every attached secondary stage. Called from `Engine.destroy`. */
  disposeAll(): void {
    for (const off of this.#physicsUnregister.values()) off()
    this.#physicsUnregister.clear()
    for (const stage of this.#_stages) stage.dispose()
    this.#_stages.clear()
  }
}
