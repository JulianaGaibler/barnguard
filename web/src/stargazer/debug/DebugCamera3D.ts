import { Camera3D } from '../camera/Camera3D'
import type { CameraView3D } from '../camera/CameraView3D'
import { quat, quatFromAxisAngle, quatMultiply } from '../math/Quat'

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'] as const
const LOOK_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const

// Mouse-look turn per pixel of pointer movement, in radians. Applied to raw
// movement deltas, NOT scaled by dt, so the feel is framerate-independent.
const MOUSE_SENSITIVITY = 0.0022
// Hold-Shift move-speed boost.
const SPRINT_MULTIPLIER = 4
// Persistent fly-speed multiplier bounds and the geometric step per wheel notch.
const SPEED_MUL_MIN = 0.1
const SPEED_MUL_MAX = 16
const SPEED_WHEEL_STEP = 1.15

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
  // Null when the inspected stage has no current 3D camera. reset/step then keep
  // this camera's own defaults.
  #gameCamera: CameraView3D | null
  #eye = { x: 0, y: 0, z: 0 }
  #yaw = 0
  #pitch = 0
  // Mouse-look deltas accumulated between frames, drained in step().
  #lookDx = 0
  #lookDy = 0
  // Hold-Shift sprint, set by the controller.
  #sprint = false
  // Persistent wheel-driven fly-speed multiplier (a user preference).
  #speedMul = 1

  constructor(gameCamera: CameraView3D | null) {
    super()
    this.#gameCamera = gameCamera
    this.reset()
  }

  /**
   * Point the debug camera at whatever the game camera currently frames (or
   * `null`).
   */
  setGameCamera(cam: CameraView3D | null): void {
    this.#gameCamera = cam
  }

  /**
   * Snap the debug camera to the game camera's eye (looking toward the origin)
   * and snapshot its projection. The projection is captured here, at
   * invocation, and then held fixed, so a game-camera ortho⇄perspective
   * animation doesn't warp the inspection view. Only aspect keeps tracking (for
   * resize).
   */
  reset(): void {
    const g = this.#gameCamera
    if (!g) return
    const eye = g.eyePosition()
    this.#eye = { x: eye.x, y: eye.y, z: eye.z }
    // Face the world origin from the current eye.
    const dx = -eye.x
    const dy = -eye.y
    const dz = -eye.z
    const len = Math.hypot(dx, dy, dz) || 1
    this.#yaw = Math.atan2(-dx / len, -dz / len)
    this.#pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)))
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
    this.#lookDx = 0
    this.#lookDy = 0
    this.#sprint = false
  }

  /** Accumulate raw pointer movement (device pixels) for mouse-look. */
  look(dx: number, dy: number): void {
    this.#lookDx += dx
    this.#lookDy += dy
  }

  /** Hold-Shift sprint on/off. */
  setSprint(on: boolean): void {
    this.#sprint = on
  }

  /** Scale the fly-speed multiplier by one wheel notch (scroll up = faster). */
  adjustSpeedMultiplier(wheelDeltaY: number): void {
    const factor = wheelDeltaY < 0 ? SPEED_WHEEL_STEP : 1 / SPEED_WHEEL_STEP
    this.#speedMul = Math.max(
      SPEED_MUL_MIN,
      Math.min(SPEED_MUL_MAX, this.#speedMul * factor),
    )
  }

  /** Current persistent fly-speed multiplier, for the debug HUD readout. */
  get speedMultiplier(): number {
    return this.#speedMul
  }

  /** Whether sprint is currently held. */
  get sprinting(): boolean {
    return this.#sprint
  }

  /** Advance the fly camera from held keys + mouse-look. Call once per frame. */
  step(dt: number): void {
    // Track only aspect so a resize stays correct. The rest of the projection
    // was snapshotted at reset() and stays put through game-camera transitions.
    if (this.#gameCamera) this.setAspect(this.#gameCamera.aspect)

    // Look: drain accumulated mouse deltas (right-drag turns right, mouse-down
    // looks down, matching the arrow-key signs below), then add held arrow keys.
    // The clamp sits above the held-keys early-return so mouse-only look with no
    // keys down is still bounded.
    const hadMouseLook = this.#lookDx !== 0 || this.#lookDy !== 0
    this.#yaw -= this.#lookDx * MOUSE_SENSITIVITY
    this.#pitch -= this.#lookDy * MOUSE_SENSITIVITY
    this.#lookDx = 0
    this.#lookDy = 0
    const lookRate = 1.6 * dt
    if (this.#held.has('ArrowLeft')) this.#yaw += lookRate
    if (this.#held.has('ArrowRight')) this.#yaw -= lookRate
    if (this.#held.has('ArrowUp')) this.#pitch += lookRate
    if (this.#held.has('ArrowDown')) this.#pitch -= lookRate
    const maxPitch = Math.PI / 2 - 0.01
    this.#pitch = Math.max(-maxPitch, Math.min(maxPitch, this.#pitch))

    // No translation keys held: update the pose only if the mouse turned, then
    // stop (avoids a redundant #applyPose on a fully idle frame).
    if (this.#held.size === 0) {
      if (hadMouseLook) this.#applyPose()
      return
    }

    // Move at a rate proportional to the focal distance so it feels consistent,
    // scaled by the persistent speed multiplier and the sprint boost.
    const speed =
      (this.#gameCamera?.focalDistance ?? this.focalDistance) *
      0.9 *
      dt *
      this.#speedMul *
      (this.#sprint ? SPRINT_MULTIPLIER : 1)
    const sinY = Math.sin(this.#yaw)
    const cosY = Math.cos(this.#yaw)
    // Forward/right on the horizontal (yaw) plane; camera looks down -z.
    const fwd = { x: -sinY, z: -cosY }
    const right = { x: cosY, z: -sinY }
    let mx = 0
    let mz = 0
    let my = 0
    if (this.#held.has('KeyW')) {
      mx += fwd.x
      mz += fwd.z
    }
    if (this.#held.has('KeyS')) {
      mx -= fwd.x
      mz -= fwd.z
    }
    if (this.#held.has('KeyD')) {
      mx += right.x
      mz += right.z
    }
    if (this.#held.has('KeyA')) {
      mx -= right.x
      mz -= right.z
    }
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
