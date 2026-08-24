/**
 * The monster's face as one flat picture, for the menu backdrop.
 *
 * @remarks
 *   Rasterised rather than parsed into paths. `parseSvgPaths` reads `<path>`
 *   elements only, and everything structural in this drawing is an `<ellipse>`
 *   plus a `<mask>` for the teeth, so a parse would hand back the tongue and
 *   nothing else.
 *
 *   Held by a module-scope `AssetLoader` for the life of the booth. The engine
 *   keys a `drawImage` texture by source-object identity and never evicts one,
 *   so a loader scoped to a visit to the menu would upload a fresh picture each
 *   time and leak the last.
 * @example
 *   const face = await loadMenuFace()
 *   gfx.drawImage(face.image, x, y, w, w / face.aspect)
 */
import { AssetLoader, rasterizeSvg } from '@src/stargazer'
import raw from '../../assets/menu-mouth.svg?raw'

/**
 * Oversample. The face is drawn taller than its authored 446px on a booth
 * screen, and the raster carries a mip chain, so this costs memory rather than
 * sharpness.
 */
const RASTER_SCALE = 2

/** Authored size, which every proportion below is a fraction of. */
const ART_WIDTH = 802
const ART_HEIGHT = 313

/** Width over height, so a caller can size the picture by either one. */
export const MENU_FACE_ASPECT = ART_WIDTH / ART_HEIGHT

/**
 * The mouth's opening, as fractions of the drawing's width and height.
 *
 * The falling cards are placed and cut off against these rather than against
 * the picture's edges: a card has to come down INSIDE the opening to be eaten,
 * and one dropping past the corner of the picture lands on the floor beside the
 * monster instead.
 */
export const MENU_MOUTH = {
  centerXFrac: 400.5 / ART_WIDTH,
  centerYFrac: 252 / ART_HEIGHT,
  halfWidthFrac: 323.5 / ART_WIDTH,
  halfHeightFrac: 126 / ART_HEIGHT,
} as const

export interface MenuFace {
  image: HTMLCanvasElement
  aspect: number
}

const loader = new AssetLoader()

export async function loadMenuFace(): Promise<MenuFace> {
  return loader.load(`monsters-int:menu-face@${RASTER_SCALE}`, async () => ({
    image: await rasterizeSvg(raw, { scale: RASTER_SCALE }),
    aspect: MENU_FACE_ASPECT,
  }))
}
