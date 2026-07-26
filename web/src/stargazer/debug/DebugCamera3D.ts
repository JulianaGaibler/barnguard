import { Camera3D } from '../camera/Camera3D'
import { quat, quatFromAxisAngle, quatMultiply } from '../math/Quat'

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'] as const
const LOOK_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const

/**
 * Free-fly inspection camera for the 3D scene. Extends {@link Camera3D} so the
 * 3D render pass and gizmo pass can swap it in transparently. WASD moves on the
 * yaw plane, Q/E rise and fall on world Y, and the arrow keys look around. Its
 * projection mirrors the game camera's each step, so it matches the current
 * ortho<->perspective blend.
 *
 * @category Debug
 */
export class DebugCamera3D extends Camera3D {
  readonly #held = new Set<string>()
  #gameCamera: Camera3D
  #eye = { x: 0, y: 0, z: 0 }
  #yaw = 0
  #pitch = 0

  constructor(gameCamera: Camera3D) {
    super()
    this.#gameCamera = gameCamera
    this.reset()
  }

  /** Point the debug camera at whatever the game camera currently frames. */
  setGameCamera(cam: Camera3D): void {
    this.#gameCamera = cam
  }

  /**
   * Snap the debug camera to the game camera's eye (looking toward the origin)
   * and snapshot its projection. The projection is captured here, at invocation,
   * and then held fixed, so a game-camera ortho⇄perspective animation doesn't
   * warp the inspection view. Only aspect keeps tracking (for resize).
   */
  reset(): void {
    const eye = this.#gameCamera.eyePosition()
    this.#eye = { x: eye.x, y: eye.y, z: eye.z }
    // Face the world origin from the current eye.
    const dx = -eye.x
    const dy = -eye.y
    const dz = -eye.z
    const len = Math.hypot(dx, dy, dz) || 1
    this.#yaw = Math.atan2(-dx / len, -dz / len)
    this.#pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)))
    const g = this.#gameCamera
    this.fovY = g.fovY
    this.near = g.near
    this.far = g.far
    this.focalDistance = g.focalDistance
    this.projectionness = g.projectionness
    this.setAspect(g.aspect)
    this.#applyPose()
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) this.#held.add(code)
    else this.#held.delete(code)
  }

  clearKeys(): void {
    this.#held.clear()
  }

  /** Advance the fly camera from held keys. Call once per frame while active. */
  step(dt: number): void {
    // Track only aspect so a resize stays correct; the rest of the projection
    // was snapshotted at reset() and stays put through game-camera transitions.
    this.setAspect(this.#gameCamera.aspect)
    if (this.#held.size === 0) return

    const lookRate = 1.6 * dt
    if (this.#held.has('ArrowLeft')) this.#yaw += lookRate
    if (this.#held.has('ArrowRight')) this.#yaw -= lookRate
    if (this.#held.has('ArrowUp')) this.#pitch += lookRate
    if (this.#held.has('ArrowDown')) this.#pitch -= lookRate
    const maxPitch = Math.PI / 2 - 0.01
    this.#pitch = Math.max(-maxPitch, Math.min(maxPitch, this.#pitch))

    // Move at a rate proportional to the focal distance so it feels consistent.
    const speed = this.#gameCamera.focalDistance * 0.9 * dt
    const sinY = Math.sin(this.#yaw)
    const cosY = Math.cos(this.#yaw)
    // Forward/right on the horizontal (yaw) plane; camera looks down -z.
    const fwd = { x: -sinY, z: -cosY }
    const right = { x: cosY, z: -sinY }
    let mx = 0
    let mz = 0
    let my = 0
    if (this.#held.has('KeyW')) { mx += fwd.x; mz += fwd.z }
    if (this.#held.has('KeyS')) { mx -= fwd.x; mz -= fwd.z }
    if (this.#held.has('KeyD')) { mx += right.x; mz += right.z }
    if (this.#held.has('KeyA')) { mx -= right.x; mz -= right.z }
    if (this.#held.has('KeyE')) my += 1
    if (this.#held.has('KeyQ')) my -= 1
    this.#eye.x += mx * speed
    this.#eye.y += my * speed
    this.#eye.z += mz * speed
    this.#applyPose()
  }

  #applyPose(): void {
    // Orientation: yaw about world Y, then pitch about local X.
    const q = quatMultiply(
      quat(),
      quatFromAxisAngle(quat(), 0, 1, 0, this.#yaw),
      quatFromAxisAngle(quat(), 1, 0, 0, this.#pitch),
    )
    this.transform.setPosition(this.#eye.x, this.#eye.y, this.#eye.z)
    this.transform.setRotation(q.x, q.y, q.z, q.w)
  }

  /** True if `code` is a key this camera consumes (move or look). */
  static isControlKey(code: string): boolean {
    return (
      (MOVE_KEYS as readonly string[]).includes(code) ||
      (LOOK_KEYS as readonly string[]).includes(code)
    )
  }
}
