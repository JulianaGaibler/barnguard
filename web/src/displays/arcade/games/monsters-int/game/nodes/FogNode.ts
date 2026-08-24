/**
 * Raises the distance haze while the table is showing something, and lowers it
 * again once every card is at rest.
 *
 * @remarks
 *   The fog is the stage's, not the scene's, so this owns restoring it. A game
 *   that left it up would haze the launcher and every game played after it.
 *
 *   There is no strength dial on `Fog`, so the fade slides the whole ramp out
 *   past the far edge of the table instead. Moving `end` alone would flatten
 *   the falloff on the way rather than lifting it evenly, and `start` alone
 *   cannot pass `end`.
 */
import { moveToward, Node3D, type Fog } from '@src/stargazer'
import { FOG } from '../tuning'

const WIDTH = FOG.end - FOG.start

export class FogNode extends Node3D {
  readonly #fog: Fog
  /** Zero is clear, one is the haze at full strength. */
  #level = 0
  #target = 0

  constructor(fog: Fog) {
    super('monsters-int-fog')
    this.#fog = fog
    fog.mode = 'linear'
    fog.color = FOG.color
    fog.enabled = true
    this.#write()
  }

  #raised = false
  #spotlit = false

  /** Bring the haze up, or take it down. */
  setRaised(raised: boolean): void {
    this.#raised = raised
    this.#retarget()
  }

  /**
   * Close the haze in past where anything else asks for it, for the beat a
   * round is won on.
   *
   * The winning row hovers toward the camera and stays in front of the ramp, so
   * this spotlights it using the fog that is already there rather than a second
   * render pass. It cannot dim a seat by the buttons, which sits nearer the
   * camera than the row does.
   */
  setSpotlight(on: boolean): void {
    this.#spotlit = on
    this.#retarget()
  }

  #retarget(): void {
    this.#target = this.#spotlit ? FOG.spotlight : this.#raised ? 1 : 0
  }

  override onUpdate(dt: number): void {
    if (this.#level === this.#target) return
    this.#level = moveToward(this.#level, this.#target, dt / FOG.fade)
    this.#write()
  }

  #write(): void {
    const start = FOG.clear + (FOG.start - FOG.clear) * this.#level
    // `end` is clamped to stay above `start`, so it has to be written second.
    this.#fog.start = start
    this.#fog.end = start + WIDTH
  }

  override destroy(): void {
    this.#fog.enabled = false
    super.destroy()
  }
}
