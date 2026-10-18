import { ImageNode, Layer } from '@src/stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
import type { Illustration } from '../story/types'
import { illustrationDither, illustrationSettings } from './ditherLook'
import type { Box } from './layout'

/** Decoded images by address, so going back to a screen draws at once. */
const decoded = new Map<string, Promise<HTMLImageElement>>()

function decode(src: string): Promise<HTMLImageElement> {
  let image = decoded.get(src)
  if (!image) {
    const element = new Image()
    element.src = src
    image = element.decode().then(() => element)
    decoded.set(src, image)
    // A failed decode is not kept, so a later screen can try again.
    image.catch(() => decoded.delete(src))
  }
  return image
}

/**
 * The illustration of the screen showing, drawn by the engine in the right
 * column and dithered. The layer keeps its render, so the dither runs once per
 * illustration, and fades through its own alpha, which applies when the result
 * composites, so the dots hold still while it fades.
 *
 * `place` sets the box the picture is fitted into, in world units, and moves it
 * when the right column does. Add `layer` to the scene under the UI layer.
 */
export class IllustrationLayer {
  readonly layer: Layer
  readonly #dither = illustrationDither()
  /** The display's look, which each illustration's own choice goes over. */
  readonly #base = { ...this.#dither.settings }
  #node: ImageNode | null = null
  #image: HTMLImageElement | null = null
  /** Where the picture goes, until `place` says otherwise. */
  #box: Box = { x: 0, y: 0, width: 0, height: 0 }
  /** Counts `show` calls, so a slow decode never replaces a newer screen. */
  #latest = 0

  constructor() {
    this.layer = new Layer({
      id: 'illustration',
      space: {
        frame: { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
      },
      region: { x: 0, y: 0, width: 0, height: 0 },
      cache: 'raster',
      effects: [this.#dither],
      persistent: true,
    })
    this.layer.transform.alpha = 0
    this.layer.visible = false
  }

  /** How visible the illustration is, from 0 to 1. */
  set alpha(value: number) {
    this.layer.transform.alpha = value
    // A layer nobody can see should not take a surface.
    this.layer.visible = value > 0
  }

  /**
   * Draws `illustration` fitted inside the box, or nothing for `null`. Settles
   * once it is drawn, and settles without drawing it when a newer call came in
   * or the image would not load.
   */
  async show(illustration: Illustration | null): Promise<void> {
    const ticket = ++this.#latest
    if (!illustration) {
      this.#clear()
      return
    }
    let image: HTMLImageElement
    try {
      image = await decode(illustration.src)
    } catch (error) {
      if (ticket === this.#latest) this.#clear()
      console.warn('[age-verification] an illustration failed to load', error)
      return
    }
    if (ticket !== this.#latest) return
    this.#clear()
    Object.assign(
      this.#dither.settings,
      illustrationSettings(this.#base, illustration.dither),
    )
    this.#image = image
    this.#node = new ImageNode({ id: 'illustration-image', image })
    this.#fit()
    this.layer.add(this.#node)
  }

  /** Sets the box, in world units, the picture is fitted inside. */
  place(box: Box): void {
    this.#box = box
    this.layer.region = { ...box }
    this.#fit()
  }

  destroy(): void {
    this.#latest++
    this.layer.destroy()
  }

  #clear(): void {
    this.#node?.destroy()
    this.#node = null
    this.#image = null
  }

  /** Fits the picture inside the box, centered, keeping its proportions. */
  #fit(): void {
    const node = this.#node
    const image = this.#image
    if (!node || !image) return
    const box = this.#box
    const scale = Math.min(
      box.width / image.naturalWidth,
      box.height / image.naturalHeight,
    )
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    node.x = box.x + (box.width - width) / 2
    node.y = box.y + (box.height - height) / 2
    node.width = width
    node.height = height
  }
}
