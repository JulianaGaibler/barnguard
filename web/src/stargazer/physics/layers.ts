/**
 * Collision layer/mask filtering. Each body (and optionally each collider) is
 * in one or more layers (`layer` bitmask) and scans one or more layers for
 * contacts (`mask` bitmask). Two colliders interact only when each is in a
 * layer the other scans, so filtering is symmetric.
 *
 * @category Physics
 */

/** Default layer a body occupies when none is given: bit 0. */
export const LAYER_DEFAULT = 0x00000001

/** Mask that scans every layer. */
export const LAYER_ALL = 0xffffffff

/**
 * Whether two objects should be tested for collision, given their layers and
 * masks. True when each object is in a layer the other scans.
 *
 * @category Physics
 * @example
 *   const PLAYER = 1 << 0
 *   const ENEMY = 1 << 1
 *   // A player that only collides with enemies:
 *   shouldCollide(PLAYER, ENEMY, ENEMY, PLAYER) // true
 *   shouldCollide(PLAYER, ENEMY, PLAYER, ENEMY) // false (player ignores players)
 */
export function shouldCollide(
  aLayer: number,
  aMask: number,
  bLayer: number,
  bMask: number,
): boolean {
  return (aLayer & bMask) !== 0 && (bLayer & aMask) !== 0
}
