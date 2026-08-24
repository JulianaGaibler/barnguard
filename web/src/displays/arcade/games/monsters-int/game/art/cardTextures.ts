/**
 * The card faces, rasterised once and shared by every card that shows them.
 *
 * @remarks
 *   The loader is module-scope on purpose. The engine keys a GPU texture by
 *   object identity and never evicts, so a session-scoped loader would upload a
 *   fresh set every match and leak the last one.
 *
 *   There are 23 faces and up to 94 cards, so a face is shared rather than owned:
 *   the count of textures does not grow with the number of players. The same
 *   rasters serve the 2D menu backdrop through {@link loadCardImages}, which
 *   hands back the canvases rather than uploaded textures. One rasterisation,
 *   so the cards falling into the mouth on the menu are the exact art the table
 *   deals.
 * @example
 *   const faces = await loadCardTextures()
 *   card.setFace(faces[faceOf(deckCard.card)])
 */
import {
  AssetLoader,
  createTexture,
  rasterizeSvg,
  type MaterialTexture,
} from '@src/stargazer'
import type { CardFaceId } from '../rules/cards'
import { CARD } from '../tuning'

/**
 * Every face plus the back, keyed by the id `faceOf` returns.
 *
 * Globbed rather than listed. The keys ARE the face ids, so a file and its id
 * cannot drift apart, and `loadCardTextures` fails loudly if one is missing.
 */
const SVG = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../assets/cards/*.svg', {
      query: '?raw',
      eager: true,
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, svg]) => [path.replace(/^.*\/|\.svg$/g, ''), svg]),
)

/** The reverse every card shows, shared by all of them. */
export const CARD_BACK: CardFaceId = 'card-back'

/**
 * Oversample. A card draws near 128 design px at rest and far larger at the
 * reveal, on a booth screen bigger than the design size. Per-source textures
 * carry a mip chain, so the extra resolution costs memory rather than
 * sharpness.
 */
const RASTER_SCALE = 2

const loader = new AssetLoader()

export type CardTextures = Record<CardFaceId, MaterialTexture>

/** The same faces as flat canvases, for `gfx.drawImage` in a 2D scene. */
export type CardImages = Record<CardFaceId, HTMLCanvasElement>

/**
 * Every face rasterised for 2D drawing, with the corners taken off.
 *
 * Cached beside the textures rather than derived from them: a `MaterialTexture`
 * is an upload and cannot be drawn with `drawImage`, so the canvas is what the
 * menu needs. The engine keys a drawImage texture by source-object identity and
 * never evicts, which is why one module-scope loader holds them for the life of
 * the booth instead of a fresh set per visit to the menu.
 */
export async function loadCardImages(): Promise<CardImages> {
  return loader.load(`monsters-int:card-images@${RASTER_SCALE}`, async () => {
    const ids = Object.keys(SVG)
    const built = await Promise.all(
      ids.map(async (id) =>
        round(await rasterizeSvg(SVG[id]!, { scale: RASTER_SCALE })),
      ),
    )
    return Object.fromEntries(ids.map((id, i) => [id, built[i]!]))
  })
}

/**
 * Take the corners off a rasterised face.
 *
 * The artwork is drawn square. In the table's own 3D the rounding is geometry,
 * so a flat copy has to get it some other way, and baking it into the alpha at
 * load costs nothing per frame and survives the rotation a clip could not
 * express. The radius is the one the card mesh is built with, so the two agree
 * by construction rather than by a number typed twice.
 */
function round(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  // A face with square corners is a worse card than no card is a blank menu.
  if (!ctx) return src
  const radius = (CARD.radius / CARD.width) * src.width
  ctx.beginPath()
  ctx.roundRect(0, 0, src.width, src.height, radius)
  ctx.clip()
  ctx.drawImage(src, 0, 0)
  return out
}

export async function loadCardTextures(): Promise<CardTextures> {
  return loader.load(`monsters-int:cards@${RASTER_SCALE}`, async () => {
    const ids = Object.keys(SVG)
    const built = await Promise.all(
      ids.map(async (id) =>
        createTexture(await rasterizeSvg(SVG[id]!, { scale: RASTER_SCALE }), {
          srgb: true,
        }),
      ),
    )
    return Object.fromEntries(ids.map((id, i) => [id, built[i]!]))
  })
}
