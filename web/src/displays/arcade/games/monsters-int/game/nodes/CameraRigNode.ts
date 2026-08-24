/**
 * Holds the 3D camera over the table and keeps it in step with the arcade's 2D
 * camera.
 *
 * @remarks
 *   The arcade owns one 2D camera and pans it between the launcher and the game
 *   region. The 3D pass reads a separate camera that knows nothing about that,
 *   so without this the table would sit motionless while the launcher slid away
 *   underneath it.
 *
 *   The fix is exact rather than approximate. Under an orthographic projection,
 *   translating a camera along its own right and up axes is a pure screen-space
 *   slide with no parallax, and both arcade regions frame a 1920x1080 rect, so
 *   the vertical extent never changes during a pan. The whole correction is
 *   therefore one offset in millimetres per design pixel.
 *
 *   The camera is a child rather than a parent because `CameraNode3D` is a leaf
 *   and throws if given children. That works in our favour: the rig carries the
 *   pitch, so the camera's local `y` IS its own up axis and the pitch drops out
 *   of the arithmetic.
 */
import {
  CameraNode3D,
  Node3D,
  quat,
  quatFromAxisAngle,
  type Rect,
} from '@src/stargazer'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../../world'
import { ELEVATION, PX_TO_M } from '../project'

/** Vertical field of view, in degrees. Only sets the ortho extent scale. */
const FOV_Y_DEG = 35

/**
 * Depth range. Generous because the slide moves the camera a full region height
 * during the pan, and a frustum sized for the settled pose would clip the table
 * on the way in.
 */
const NEAR = 0.01
const FAR = 24

/** What the rig needs from the arcade's camera lease. */
export interface CameraSource {
  /** The world rect framed right now, which tracks a pan in progress. */
  readonly viewport: Rect
}

/**
 * How far the 3D camera moves along its own axes so the table tracks a 2D
 * framing, in metres.
 *
 * Panning the 2D camera down by one region height moves the game content a
 * region height up the screen, so the 3D camera moves the same distance down to
 * match.
 */
export function cameraSlide(framing: Rect): { right: number; up: number } {
  const centerX = framing.x + framing.width / 2
  const centerY = framing.y + framing.height / 2
  return {
    right: (centerX - REGION_WIDTH / 2) * PX_TO_M,
    up: -(centerY - REGION_HEIGHT / 2) * PX_TO_M,
  }
}

/**
 * Orthographic focal distance that puts one design pixel on one millimetre of
 * table, for a view this many design pixels tall.
 */
export function focalFor(visibleHeightPx: number): number {
  const halfFov = ((FOV_Y_DEG / 2) * Math.PI) / 180
  return (visibleHeightPx * PX_TO_M) / (2 * Math.tan(halfFov))
}

export class CameraRigNode extends Node3D {
  readonly camera = new CameraNode3D('monsters-int-camera')
  readonly #source: CameraSource
  /** Visible height of the game region in design pixels, refreshed on resize. */
  #visibleHeightPx: number
  /**
   * How far back the eye sits, when that has to be more than the focal length.
   *
   * The two are the same thing at the table, and separate as soon as anything
   * frames a smaller slice of it. Under an orthographic projection the extent
   * comes from `focalDistance` and the position only decides what is clipped,
   * so a close crop moves the eye to within a few centimetres of the table
   * while `hoverFromLayout` is still pulling the foreground the better part of
   * a metre toward it. Held-up cards land behind the eye and vanish. Standing
   * further back changes nothing about the framing and keeps them in front.
   */
  #standoff: number
  #lastFocal = -1
  #lastRight = Number.NaN
  #lastUp = Number.NaN

  constructor(source: CameraSource, visibleHeightPx: number, standoff = 0) {
    super('monsters-int-camera-rig')
    this.#source = source
    this.#visibleHeightPx = visibleHeightPx
    this.#standoff = standoff

    const pitch = quatFromAxisAngle(quat(), 1, 0, 0, -ELEVATION)
    this.transform.setRotation(pitch.x, pitch.y, pitch.z, pitch.w)

    this.camera.projectionness = 0
    this.camera.fovY = FOV_Y_DEG
    this.camera.near = NEAR
    this.camera.far = FAR
    this.add(this.camera)
    this.sync()
  }

  /** Take the current canvas size. The framing is read live, so it is not here. */
  setVisibleHeight(px: number): void {
    this.#visibleHeightPx = px
    this.sync()
  }

  /**
   * Runs in the update walk rather than a before-frame handler, which fires
   * ahead of the animation tick and would leave the table one frame behind the
   * pan.
   */
  override onUpdate(): void {
    this.sync()
  }

  /** Write the pose, skipping writes that would not change it. */
  sync(): void {
    const focal = focalFor(this.#visibleHeightPx)
    const { right, up } = cameraSlide(this.#source.viewport)
    if (
      focal === this.#lastFocal &&
      right === this.#lastRight &&
      up === this.#lastUp
    ) {
      return
    }
    this.#lastFocal = focal
    this.#lastRight = right
    this.#lastUp = up
    this.camera.focalDistance = focal
    this.camera.transform.setPosition(
      right,
      up,
      Math.max(focal, this.#standoff),
    )
  }

  makeCurrent(): void {
    this.camera.makeCurrent()
  }
}
