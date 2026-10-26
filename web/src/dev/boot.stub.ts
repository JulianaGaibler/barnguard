/**
 * Stands in for `boot.ts` in a single-display build, which has no dev surfaces.
 * See `vite/displays.ts`.
 */
export async function bootDevSurface(): Promise<boolean> {
  return false
}
