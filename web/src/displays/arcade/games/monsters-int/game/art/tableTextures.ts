/**
 * Table artwork, rasterised once and shared by every mesh that draws it.
 *
 * @remarks
 *   The loader is module-scope on purpose. The engine keys a texture by object
 *   identity and never evicts, so a session-scoped loader would upload a fresh
 *   set on every match and leak the last one.
 */
import {
  AssetLoader,
  createTexture,
  rasterizeSvg,
  type MaterialTexture,
} from '@src/stargazer'
import { displayFont } from '../../fonts'
import mouthSvg from '../../assets/mouth.svg?raw'

/**
 * Oversample, because the mouth spans a third of the frame and the booth screen
 * is larger than the design size. Per-source textures carry a mip chain, so the
 * extra resolution costs memory rather than sharpness.
 */
const RASTER_SCALE = 3

const loader = new AssetLoader()

/** A word rasterised to its own glyph bounds, and the aspect that implies. */
export interface WordArt {
  texture: MaterialTexture
  /** Width over height of the drawn glyphs, for sizing the mesh it goes on. */
  aspect: number
}

/**
 * Cap height the word is rasterised at. Oversampled well past the size it draws
 * at, since the mesh carries a mip chain and the booth screen is larger than
 * the design size.
 */
const WORD_RASTER = 220

/**
 * A word, as artwork lying on the table.
 *
 * Drawn to a canvas rather than through the 2D text stack, because the 2D
 * layers sit over the whole 3D pass and a label there would float above the
 * button instead of resting beside it.
 *
 * Cropped to the glyphs rather than centred in a fixed box. A fixed box makes
 * the drawn size depend on how much air happens to be around the word, so HIT
 * and STAY come out at two different letter sizes for the same mesh.
 */
export async function loadWordArt(
  word: string,
  color: string,
): Promise<WordArt> {
  return loader.load(`monsters-int:word:${word}:${color}`, async () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const font = displayFont(WORD_RASTER)
    ctx.font = font
    const m = ctx.measureText(word)
    // Room for the antialiased edge, which falls outside the reported bounds.
    const pad = Math.ceil(WORD_RASTER * 0.05)
    canvas.width =
      Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2
    canvas.height =
      Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) +
      pad * 2
    // Sizing the canvas resets every context property, so the font goes on after.
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(
      word,
      pad + m.actualBoundingBoxLeft,
      pad + m.actualBoundingBoxAscent,
    )
    return {
      texture: await createTexture(canvas, { srgb: true }),
      aspect: canvas.width / canvas.height,
    }
  })
}

export async function loadMouthTexture(): Promise<MaterialTexture> {
  return loader.load(`monsters-int:mouth@${RASTER_SCALE}`, async () =>
    createTexture(await rasterizeSvg(mouthSvg, { scale: RASTER_SCALE }), {
      srgb: true,
      // A hard alpha cutout, so filtered mips would eat the tooth edges.
      mipmap: false,
    }),
  )
}
