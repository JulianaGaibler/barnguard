import { Node2D } from '../scene/Node2D'
import { definePaintProps } from '../render/picture/paintProps'
import type { Canvas } from '../render/picture/Canvas'

/** Constructor options for {@link ImageNode}. */
export interface ImageNodeOptions {
  id?: string
  /** The image to draw. It must have finished loading. */
  image: CanvasImageSource
  /** Left edge in local space. Default `0`. */
  x?: number
  /** Top edge in local space. Default `0`. */
  y?: number
  /**
   * Drawn width. Defaults to the image's natural width, or to `height` times
   * its aspect ratio when only `height` is given.
   */
  width?: number
  /**
   * Drawn height. Defaults to the image's natural height, or to `width` over
   * its aspect ratio when only `width` is given.
   */
  height?: number
  /** Filter the image when it is scaled. Default `true`. */
  smoothing?: boolean
}

/**
 * Draws an image, such as a loaded `<img>`, an `ImageBitmap` or a canvas, as a
 * rectangle in local space. Every option is a plain public field, so assigning
 * a new `image` or size shows on the next frame.
 *
 * @remarks
 *   The GPU samples the image bilinearly with no mipmaps, so an image drawn at a
 *   fraction of its natural size aliases. Scale it once to the drawn size
 *   first, for example with `createImageBitmap(img, { resizeWidth,
 *   resizeHeight, resizeQuality: 'high' })`.
 * @example
 *   const img = new Image()
 *   img.src = '/logo.png'
 *   await img.decode()
 *   // 40 high, with the width that keeps the logo's proportions.
 *   scene.root.add(new ImageNode({ image: img, x: 16, y: 16, height: 40 }))
 */
export class ImageNode extends Node2D {
  // Live mirrors of ImageNodeOptions, documented there. Each is a paint
  // property, so assigning a new value repaints the node.
  declare image: CanvasImageSource
  declare x: number
  declare y: number
  declare width: number | undefined
  declare height: number | undefined
  declare smoothing: boolean

  constructor(opts: ImageNodeOptions) {
    super(opts.id)
    definePaintProps(this, {
      image: opts.image,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      width: opts.width as number | undefined,
      height: opts.height as number | undefined,
      smoothing: opts.smoothing ?? true,
    })
  }

  /** The size the image is drawn at, after the defaults. */
  get drawnSize(): { width: number; height: number } {
    const natural = naturalSize(this.image)
    const aspect = natural.height > 0 ? natural.width / natural.height : 1
    if (this.width !== undefined && this.height !== undefined) {
      return { width: this.width, height: this.height }
    }
    if (this.width !== undefined) {
      return { width: this.width, height: this.width / aspect }
    }
    if (this.height !== undefined) {
      return { width: this.height * aspect, height: this.height }
    }
    return natural
  }

  override paint(canvas: Canvas): void {
    const { width, height } = this.drawnSize
    if (width <= 0 || height <= 0) return
    canvas.drawImage(this.image, this.x, this.y, width, height, {
      smoothing: this.smoothing,
    })
  }
}

/** The intrinsic pixel size of an image source, 0 × 0 before it loads. */
export function naturalSize(image: CanvasImageSource): {
  width: number
  height: number
} {
  if ('naturalWidth' in image) {
    return { width: image.naturalWidth, height: image.naturalHeight }
  }
  if ('videoWidth' in image) {
    return { width: image.videoWidth, height: image.videoHeight }
  }
  if ('displayWidth' in image) {
    return { width: image.displayWidth, height: image.displayHeight }
  }
  return { width: length(image.width), height: length(image.height) }
}

/** An SVG image's size is an animated length, every other source's a number. */
function length(value: number | SVGAnimatedLength): number {
  return typeof value === 'number' ? value : value.baseVal.value
}
