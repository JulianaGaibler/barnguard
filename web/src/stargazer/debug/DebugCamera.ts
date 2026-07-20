import { Camera } from '../camera/Camera'

const PAN_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const
const ZOOM_IN_KEY = 'KeyE'
const ZOOM_OUT_KEY = 'KeyQ'

/**
 * Free camera controlled by keyboard. Extends the base Camera so the renderer
 * can swap it in transparently, anything that reads world↔screen projection off
 * a Camera keeps working.
 *
 * @category Debug
 */
export class DebugCamera extends Camera {
  readonly #held = new Set<string>()
  #_follow = false
  #gameCamera: Camera

  constructor(gameCamera: Camera) {
    super({ ...gameCamera.viewport }, { ...gameCamera.pixelSize })
    this.#gameCamera = gameCamera
  }

  get follow(): boolean {
    return this.#_follow
  }
  setFollow(v: boolean): void {
    this.#_follow = v
    if (v) this.setViewport({ ...this.#gameCamera.viewport })
  }

  /**
   * Retarget the debug camera to a new game camera. Called when the debug HUD's
   * active stage changes, the debug camera should now follow / reset against
   * the new stage's camera. Callers usually invoke `reset()` after.
   */
  setGameCamera(cam: Camera): void {
    this.#gameCamera = cam
    if (this.#_follow) this.setViewport({ ...cam.viewport })
  }

  /** Snap to whatever the game camera currently shows. */
  reset(): void {
    this.setViewport({ ...this.#gameCamera.viewport })
  }

  /** Report a key state change (down / up). */
  setKey(code: string, pressed: boolean): void {
    if (pressed) this.#held.add(code)
    else this.#held.delete(code)
  }

  clearKeys(): void {
    this.#held.clear()
  }

  /**
   * Called once per frame while the debug camera is active. Applies pan/zoom
   * from currently-held keys.
   */
  step(dt: number): void {
    if (this.#_follow) {
      this.setViewport({ ...this.#gameCamera.viewport })
      return
    }
    if (this.#held.size === 0) return
    // Pan: 0.7× viewport per second at full press (feels the same at any zoom).
    const panRate = 0.7 * dt
    let vx = this.viewport.x
    let vy = this.viewport.y
    let vw = this.viewport.width
    let vh = this.viewport.height
    if (this.#held.has('KeyW')) vy -= vh * panRate
    if (this.#held.has('KeyS')) vy += vh * panRate
    if (this.#held.has('KeyA')) vx -= vw * panRate
    if (this.#held.has('KeyD')) vx += vw * panRate
    // Zoom: exponential factor per second.
    const zoomRate = 1.5 * dt
    let factor = 1
    if (this.#held.has(ZOOM_IN_KEY)) factor *= Math.exp(-zoomRate)
    if (this.#held.has(ZOOM_OUT_KEY)) factor *= Math.exp(zoomRate)
    if (factor !== 1) {
      const cx = vx + vw / 2
      const cy = vy + vh / 2
      vw *= factor
      vh *= factor
      vx = cx - vw / 2
      vy = cy - vh / 2
    }
    this.setViewport({ x: vx, y: vy, width: vw, height: vh })
  }

  /** True if `code` is one of the pan/zoom keys this camera consumes. */
  static isControlKey(code: string): boolean {
    return (
      code === ZOOM_IN_KEY ||
      code === ZOOM_OUT_KEY ||
      (PAN_KEYS as readonly string[]).includes(code)
    )
  }
}
