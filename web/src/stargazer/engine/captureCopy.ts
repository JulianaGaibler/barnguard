/**
 * Copy a stage canvas's current frame into a 2D `OffscreenCanvas`.
 *
 * A GPU canvas without a preserved drawing buffer is only readable until the
 * browser composites it, so this must run in the same task as the render that
 * filled it.
 */
export function copyCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number,
): OffscreenCanvas {
  const surface = new OffscreenCanvas(width, height)
  const ctx = surface.getContext('2d')
  if (!ctx) throw new Error('stargazer: capture could not get a 2D context')
  ctx.drawImage(source, 0, 0, width, height)
  return surface
}
