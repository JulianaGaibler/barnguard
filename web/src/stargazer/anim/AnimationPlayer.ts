import { Node3D } from '../scene/Node3D'
import { applyAnimation, type AnimationClip } from './AnimationClip'

/**
 * Options for an {@link AnimationPlayer}.
 *
 * @category Animation
 */
export interface AnimationPlayerOptions {
  /** Start playing immediately. Default `true`. */
  autoplay?: boolean
  /** Loop at the clip's end. Default `true`. */
  loop?: boolean
  /** Playback rate (1 = real time; negative plays backward). Default `1`. */
  speed?: number
}

/**
 * Plays an {@link AnimationClip} by sampling it each engine update and writing
 * the result into the clip's target node transforms. It's a {@link Node3D}, so
 * `loadGltf` attaches one under the model root and it ticks with the tree; its
 * own transform is unused. Because it writes through the transform setters, the
 * dirty-flag cascade fires and the update runs before the frame's world-matrix
 * pass, so animated nodes render in their new pose the same frame.
 *
 * @category Animation
 * @example
 *   const model = await loadGltf('/robot.glb') // auto-plays its clip
 *   engine.tree.add(model)
 */
export class AnimationPlayer extends Node3D {
  clip: AnimationClip | null
  /** Playhead in seconds. */
  time = 0
  speed: number
  /** Loop at the clip's end (named `looping` to avoid the base `loop()` helper). */
  looping: boolean
  playing: boolean

  constructor(
    clip: AnimationClip | null = null,
    opts: AnimationPlayerOptions = {},
    id?: string,
  ) {
    super(id)
    this.clip = clip
    this.speed = opts.speed ?? 1
    this.looping = opts.loop ?? true
    this.playing = opts.autoplay ?? true
  }

  /** Resume playback (optionally rewinding to the start). */
  resume(fromStart = false): void {
    if (fromStart) this.time = 0
    this.playing = true
  }

  /** Pause playback, holding the current pose. */
  pause(): void {
    this.playing = false
  }

  // Defined on the prototype so the base constructor detects it and the engine
  // ticks this node (a field assignment would be missed by `_hasUpdateWork`).
  override onUpdate(dt: number): void {
    const clip = this.clip
    if (!this.playing || !clip) return
    this.time += dt * this.speed
    const dur = clip.duration
    if (dur > 0) {
      if (this.looping) this.time = ((this.time % dur) + dur) % dur
      else this.time = Math.max(0, Math.min(this.time, dur))
    }
    applyAnimation(clip, this.time)
  }
}
