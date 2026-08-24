/**
 * The bridge between the reference artwork and the 3D table.
 *
 * @remarks
 *   The art is drawn in the arcade's 1920x1080 layout space with no perspective.
 *   The game puts the same composition on a real table under a pitched
 *   orthographic camera, so a point on the table has two coordinates worth
 *   naming: where it sits in the world, and where it lands on screen.
 *
 *   One design pixel is one millimetre, which makes the region 1.92m by 1.08m and
 *   a card 128mm by 194mm. Working at meter scale matters beyond tidiness,
 *   since the engine's default shadow biases are tuned for it.
 *
 *   Because the projection below is exact, 3D world space and 2D layout space are
 *   the same space. A 2D node placed at layout `(806, 880)` sits under the 3D
 *   button at `groundFromLayout(806, 779.5)` at every canvas aspect and
 *   throughout the camera pan, with no per-frame projection work. That is what
 *   lets every label and readout stay ordinary crisp 2D text.
 * @example
 *   const p = groundFromLayout(806, 779.5) // where the left button stands
 *   const { x, y } = layoutFromWorld(p) // back to 806, 779.5
 */
import { vec3, type Vec3 } from '@src/stargazer'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../world'

/** Metres per design pixel. */
export const PX_TO_M = 0.001

/**
 * How far the camera sits above the table plane, in radians.
 *
 * The art implies three different angles: the table ellipse reads as about 17
 * degrees, the mouth about 23, the button cylinders about 28. One camera has to
 * serve all three, and the buttons are the piece whose shape a wrong angle
 * ruins, so they set it. The table is drawn as an ellipse rather than a circle
 * to keep its painted silhouette under this angle.
 */
export const ELEVATION = (28 * Math.PI) / 180

const SIN_E = Math.sin(ELEVATION)
const COS_E = Math.cos(ELEVATION)

/** Layout-space centre, which the world is centred on. */
const CX = REGION_WIDTH / 2
const CY = REGION_HEIGHT / 2

/**
 * The point on the table, in metres, that projects to a layout point.
 *
 * Depth divides by `sin(ELEVATION)` because a metre of table running away from
 * the camera covers less than a metre of screen.
 */
export function groundFromLayout(x: number, y: number, out?: Vec3): Vec3 {
  const worldX = (x - CX) * PX_TO_M
  const worldZ = ((y - CY) * PX_TO_M) / SIN_E
  if (!out) return vec3(worldX, 0, worldZ)
  out.x = worldX
  out.y = 0
  out.z = worldZ
  return out
}

/**
 * Where a world point lands in layout space. The inverse of
 * {@link groundFromLayout} for points on the table, and height is handled too,
 * so a raised card projects up the screen the way the camera would put it.
 */
export function layoutFromWorld(
  p: Readonly<Vec3>,
  out?: { x: number; y: number },
): { x: number; y: number } {
  const x = CX + p.x / PX_TO_M
  const y = CY + (p.z * SIN_E - p.y * COS_E) / PX_TO_M
  if (!out) return { x, y }
  out.x = x
  out.y = y
  return out
}

/**
 * Screen height in layout pixels of a flat span running away from the camera.
 *
 * A card lying on the table loses this much of its length, which is why the
 * active hand lifts rather than the camera flattening.
 */
export function flatForeshortening(depthPx: number): number {
  return depthPx * SIN_E
}

/**
 * The depth a ground-plane mesh needs so a texture authored in screen space
 * lands on screen at its drawn size.
 *
 * Art for the table is drawn in the same layout space as everything else, so a
 * quad sized to the drawn height would come out squashed. Stretching it by the
 * inverse of the foreshortening cancels that out.
 */
export function groundDepthForScreenHeight(heightPx: number): number {
  return (heightPx * PX_TO_M) / SIN_E
}

/**
 * A point floating `height` metres above the table that still projects to a
 * layout position.
 *
 * Lifting a card and pulling it back along the table cancel out on screen under
 * an orthographic camera, so this moves an object a long way toward the viewer
 * without moving or resizing it. Only two things notice: the depth test, which
 * draws it over whatever is below, and the fog, which reads distance. Both are
 * what a hand held up to be read wants.
 */
export function hoverFromLayout(
  x: number,
  y: number,
  height: number,
  out?: Vec3,
): Vec3 {
  const ground = groundFromLayout(x, y, out)
  ground.y = height
  ground.z += (height * COS_E) / SIN_E
  return ground
}
