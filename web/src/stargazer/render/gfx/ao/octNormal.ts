/**
 * Octahedral normal encoding (Cigolle et al.), the CPU-side reference for the
 * encode in `gbuffer.wgsl` and the decode the AO shaders use. Packs a unit
 * vector into two `[0,1]` components — a normal fits the G-buffer's RG channels
 * with room to spare, so its depth stays a full depth texture.
 *
 * @example
 *   const [x, y] = octEncode(0, 0, 1) // +Z → (0.5, 0.5)
 *   const [nx, ny, nz] = octDecode(x, y)
 */

function signNotZero(v: number): number {
  return v >= 0 ? 1 : -1
}

/** Encode a unit vector to `[0,1]^2`. */
export function octEncode(
  nx: number,
  ny: number,
  nz: number,
): [number, number] {
  const d = Math.abs(nx) + Math.abs(ny) + Math.abs(nz)
  const inv = 1 / Math.max(d, 1e-8)
  let px = nx * inv
  let py = ny * inv
  if (nz < 0) {
    const ox = (1 - Math.abs(py)) * signNotZero(px)
    const oy = (1 - Math.abs(px)) * signNotZero(py)
    px = ox
    py = oy
  }
  return [px * 0.5 + 0.5, py * 0.5 + 0.5]
}

/** Decode `[0,1]^2` back to a unit vector (inverse of {@link octEncode}). */
export function octDecode(x: number, y: number): [number, number, number] {
  const fx = x * 2 - 1
  const fy = y * 2 - 1
  let nx = fx
  let ny = fy
  let nz = 1 - Math.abs(fx) - Math.abs(fy)
  const t = Math.max(-nz, 0)
  nx += nx >= 0 ? -t : t
  ny += ny >= 0 ? -t : t
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}
