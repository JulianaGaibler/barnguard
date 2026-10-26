import { Node2D, type Canvas } from 'stargazer'
import foxTailUrl from '../assets/fox-tail.svg?url'

/** The SVG's own intrinsic size (`viewBox="0 0 1161 1515"`). */
const FOX_TAIL_WIDTH = 1161
const FOX_TAIL_HEIGHT = 1515

/**
 * Load the fox-tail glow. It is drawn as a sprite rather than vector paths
 * because its gradient is radial, and a linear-gradient-only paint system
 * cannot reproduce that, a distinction the heavy blur it sits under erases
 * anyway.
 *
 * Decoded through an `<img>` element rather than `createImageBitmap`, whose SVG
 * support is inconsistent across engines (some decode a vector source only
 * through the normal image pipeline). `Gfx2D.drawImage` accepts either.
 */
export async function loadFoxTail(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`loadFoxTail: failed to load image ${foxTailUrl}`))
    img.src = foxTailUrl
  })
}

/**
 * Paints the loaded fox-tail bitmap at its own intrinsic size, in local space.
 * The node's transform (position + scale) places and sizes it, so the same
 * bitmap serves any placement without re-rasterizing.
 *
 * @example
 *   const tail = new FoxTailNode(await loadFoxTail())
 *   tail.transform.x = 697
 *   tail.transform.y = -491.6
 *   tail.transform.scaleX = tail.transform.scaleY = 1.1568
 *   stage.tree.root.add(tail)
 */
export class FoxTailNode extends Node2D {
  readonly #image: HTMLImageElement | ImageBitmap

  constructor(image: HTMLImageElement | ImageBitmap) {
    super('fox-tail')
    this.#image = image
  }

  override paint(gfx: Canvas): void {
    gfx.drawImage(this.#image, 0, 0, FOX_TAIL_WIDTH, FOX_TAIL_HEIGHT)
  }
}
