import type { DisplayManifest } from '@src/core/display'

/**
 * The lookup used by `main.ts` to resolve `?display=<id>` to a manifest.
 * Each entry is a dynamic import so unused displays never enter the bundle
 * for a given session (though on a kiosk with all displays available, they
 * all end up code-split into separate chunks anyway).
 *
 * Adding a new display: create `displays/<id>/index.ts` exporting a
 * `DisplayManifest` and register it below. The id is authoritative — it is
 * the URL param, the server `display` tag, and the SSE / games.json key.
 */
export const displayRegistry: Record<string, () => Promise<DisplayManifest>> = {
  stallwaechter: () =>
    import('./displays/stallwaechter').then((m) => m.stallwaechter),
}

export type DisplayId = keyof typeof displayRegistry
