/**
 * The two icons the screens draw: the thumb and the Firefox logo. The thumb is
 * the single path of Mozilla's 24 by 24 icon set, under the same license as
 * this repository. The logo is Mozilla's official one color symbol, which is
 * not to be redrawn. Both are tessellated once into a 96 unit box, so they stay
 * smooth up to about 96 design pixels across.
 */
import { parseSvgPaths, type Canvas } from 'stargazer'

const THUMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="#000" d="M4.928 10.428c.286 0 .553.021.798.054a1.295 1.295 0 0 1 1.131 1.28v8.905c0 .64-.474 1.19-1.107 1.277a6 6 0 0 1-1.62.003A1.295 1.295 0 0 1 3 20.667v-8.905c0-.64.475-1.189 1.107-1.277.318-.044.597-.057.82-.057m8.15-6.427c.825 0 1.494.67 1.494 1.494v3.783a36 36 0 0 1 5.265-.074c1.54.09 2.678 1.48 2.41 2.998a21.3 21.3 0 0 1-2.608 7.08c-.425.724-1.18 1.173-2.016 1.247a48 48 0 0 1-9.158-.068V11.29l2.067-3.152q.184-.28.29-.597l.838-2.518a1.49 1.49 0 0 1 1.418-1.022" /></svg>`

const FIREFOX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M190.368 150.591c.157.009.079.003 0 0m-57.874-28.933c.158.008.079.003 0 0m346.228 44.674c-10.445-25.123-31.6-52.248-48.211-60.82 13.52 26.5 21.345 53.093 24.335 72.935 0 .04.015.136.047.4-27.175-67.732-73.254-95.047-110.886-154.512-1.9-3.008-3.805-6.022-5.661-9.2a73 73 0 0 1-2.646-4.972 43.8 43.8 0 0 1-3.585-9.5.625.625 0 0 0-.546-.644.8.8 0 0 0-.451 0c-.033.011-.084.051-.119.065-.053.02-.12.069-.176.095.026-.036.083-.117.1-.135-53.437 31.3-75.587 86.093-81.282 120.97a128.1 128.1 0 0 0-47.624 12.153 6.144 6.144 0 0 0-3.041 7.63 6.034 6.034 0 0 0 8.192 3.525 116.2 116.2 0 0 1 41.481-10.826c.468-.033.937-.062 1.405-.1a118 118 0 0 1 5.932-.211 120.8 120.8 0 0 1 34.491 4.777c.654.192 1.295.414 1.946.616a120 120 0 0 1 5.539 1.842 122 122 0 0 1 3.992 1.564c1.074.434 2.148.868 3.206 1.331a119 119 0 0 1 4.9 2.307c.743.368 1.485.735 2.217 1.117a121 121 0 0 1 4.675 2.587 108 108 0 0 1 2.952 1.776 123 123 0 0 1 42.028 43.477c-12.833-9.015-35.81-17.918-57.947-14.068 86.441 43.214 63.234 192.027-56.545 186.408a106.7 106.7 0 0 1-31.271-6.031 133 133 0 0 1-7.059-2.886c-1.356-.618-2.711-1.243-4.051-1.935-29.349-15.168-53.583-43.833-56.611-78.643 0 0 11.093-41.335 79.433-41.335 7.388 0 28.508-20.614 28.9-26.593-.09-1.953-41.917-18.59-58.223-34.656-8.714-8.585-12.851-12.723-16.514-15.829a72 72 0 0 0-6.225-4.7 111.34 111.34 0 0 1-.675-58.733c-24.687 11.242-43.89 29.011-57.849 44.7h-.111c-9.528-12.067-8.855-51.873-8.312-60.184-.114-.516-7.107 3.63-8.024 4.254a175 175 0 0 0-23.486 20.12 210.5 210.5 0 0 0-22.443 26.913c0 .012-.007.025-.011.037 0-.012.007-.025.011-.038a202.8 202.8 0 0 0-32.244 72.81c-.058.265-2.29 10.054-3.92 22.147a266 266 0 0 0-.769 5.651c-.558 3.636-.992 7.6-1.42 13.767-.019.239-.031.474-.048.712a591 591 0 0 0-.481 7.995c0 .411-.025.816-.025 1.227 0 132.709 107.6 240.29 240.324 240.29 118.865 0 217.559-86.288 236.882-199.63.407-3.075.732-6.168 1.092-9.27 4.777-41.21-.53-84.525-15.588-120.747m-164.068 72.1"/></svg>`

/** The side of the box every icon is tessellated into. */
const BOX = 96
const THUMB_ARTWORK = 24
const LOGO_ARTWORK = 512

export interface Glyph {
  path: Path2D
}

function build(svg: string, artwork: number): Glyph {
  const { paths } = parseSvgPaths(svg, {
    tessellate: true,
    scale: BOX / artwork,
    flattenTol: 0.1,
  })
  const entry = paths.values().next().value
  if (!entry) throw new Error('An icon has no path.')
  return { path: entry.path }
}

let thumb: Glyph | null = null
let logo: Glyph | null = null

/** The thumbs-up. Rotate it half a turn for a thumbs-down. */
export function thumbGlyph(): Glyph {
  thumb ??= build(THUMB_SVG, THUMB_ARTWORK)
  return thumb
}

/** The Firefox logo. */
export function logoGlyph(): Glyph {
  logo ??= build(FIREFOX_SVG, LOGO_ARTWORK)
  return logo
}

/**
 * Fills `glyph` into the square at `(x, y)`, `size` on a side, turned half a
 * turn when `flip` is set. The icon's own box is the square, so a thumb keeps
 * the space the artwork leaves around it.
 */
export function drawGlyph(
  canvas: Canvas,
  glyph: Glyph,
  x: number,
  y: number,
  size: number,
  color: string,
  flip = false,
): void {
  canvas.save()
  canvas.translate(x + size / 2, y + size / 2)
  if (flip) canvas.rotate(Math.PI)
  const k = size / BOX
  canvas.scale(k, k)
  canvas.translate(-BOX / 2, -BOX / 2)
  canvas.fillPath2D(glyph.path, color)
  canvas.restore()
}
