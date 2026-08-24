/**
 * A lease over the arcade's shared background, handed to a game via
 * `GameProps`.
 *
 * @remarks
 *   The sky, the ocean and the clouds span the whole world and draw in the
 *   `static` 2D layer, which is the first thing painted each frame. That is
 *   invisible to a 2D game, whose own content draws over it. It is fatal to a
 *   3D game, because the depth-tested 3D pass runs BEFORE every 2D layer, so
 *   the sky covers the entire scene.
 *
 *   Hiding the background is therefore a game-level decision rather than
 *   something the shell can infer, and the moment to do it matters: a game that
 *   hides it while its own menu is up covers the change, where one that hides
 *   it during the launcher pan shows the sky blinking out mid-transition.
 *
 *   The arcade reclaims it on exit via {@link release}, so a game cannot leave the
 *   launcher without a sky. Calls after that are ignored, which keeps a late
 *   toggle from fighting the pan back.
 * @example
 *   // A 3D game owns its own backdrop, so it takes the sky down once it starts
 *   // and hands it back when it returns to its menu.
 *   backdrop.setVisible(false)
 */
export interface BackdropTarget {
  setVisible(visible: boolean): void
}

export class ArcadeBackdrop {
  readonly #target: BackdropTarget
  #released = false
  #visible = true

  constructor(target: BackdropTarget) {
    this.#target = target
  }

  /** Whether the shared background is drawing right now. */
  get visible(): boolean {
    return this.#visible
  }

  get released(): boolean {
    return this.#released
  }

  /** Show or hide the shared background. No-op once released. */
  setVisible(visible: boolean): void {
    if (this.#released || this.#visible === visible) return
    this.#visible = visible
    this.#target.setVisible(visible)
  }

  /** Hand the background back, restoring it. Idempotent. */
  release(): void {
    if (this.#released) return
    this.#released = true
    if (!this.#visible) {
      this.#visible = true
      this.#target.setVisible(true)
    }
  }
}
