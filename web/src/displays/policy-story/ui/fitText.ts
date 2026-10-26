/** The part of an element `fitText` needs, so a test can stand in for one. */
export interface Fittable {
  style: { setProperty(name: string, value: string): void }
  readonly scrollHeight: number
  readonly clientHeight: number
}

/** The custom property the text's font size reads. */
export const TEXT_SIZE_PROPERTY = '--text-size'

/**
 * Sets the font size of `element`'s text to the largest whole size from `min`
 * to `max` design pixels at which the text fits in the element's box, and
 * returns it. When even `min` does not fit, the text takes `min` and the
 * element has to scroll.
 *
 * The browser lays the text out, so each size is tried and measured. Bisecting
 * keeps that to a few passes.
 */
export function fitText(element: Fittable, min: number, max: number): number {
  const fits = (size: number): boolean => {
    element.style.setProperty(TEXT_SIZE_PROPERTY, `${size}px`)
    return element.scrollHeight <= element.clientHeight + 1
  }
  let low = Math.floor(Math.min(min, max))
  let high = Math.floor(max)
  if (fits(high)) return high
  if (!fits(low)) {
    element.style.setProperty(TEXT_SIZE_PROPERTY, `${low}px`)
    return low
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid)) low = mid
    else high = mid
  }
  element.style.setProperty(TEXT_SIZE_PROPERTY, `${low}px`)
  return low
}

/** Up to this many characters counts as a few words. */
const FEW_CHARACTERS = 120
/** How much larger a few words are set. */
const FEW_WORDS_GROWTH = 1.35
/** The smallest the text gets when it has to shrink, as a share of its size. */
const SHRINK_WIDE = 0.78
const SHRINK_NARROW = 0.75
/** Windows narrower than this many CSS pixels shrink their text the least. */
const NARROW_CSS_PX = 700

/**
 * The size of body text, in CSS pixels, for a window `cssWidth` CSS pixels
 * wide: 20 on a phone, about 24 on a tablet held upright, 28 on a laptop and 32
 * on a 1920 pixel screen. A small screen is held close and a big one is read
 * from further away, but not by as much as its width.
 */
export function bodyCssPx(cssWidth: number): number {
  const size = 20 + (cssWidth - 390) * 0.00784
  return Math.min(Math.max(size, 20), 34)
}

/**
 * The font sizes, in design pixels, a screen's text may take: the largest, for
 * a few words set big, and the smallest the text shrinks to before its box has
 * to scroll. `cssPxInWorld` is the design pixels in one CSS pixel.
 */
export function textRange(
  characters: number,
  cssPxInWorld: number,
  cssWidth: number,
  large = true,
): { min: number; max: number } {
  const body = bodyCssPx(cssWidth) * cssPxInWorld
  const max =
    large && characters <= FEW_CHARACTERS ? body * FEW_WORDS_GROWTH : body
  const shrink = cssWidth < NARROW_CSS_PX ? SHRINK_NARROW : SHRINK_WIDE
  return { min: body * shrink, max }
}

/** The part of a child element `contentHeight` reads. */
interface Placed {
  readonly offsetTop: number
  readonly offsetHeight: number
}

/**
 * The height the children of a box take, from the top of the first to the
 * bottom of the last, wherever the box places them. Zero for no children. The
 * children must be elements, which have an `offsetTop`.
 */
export function contentHeight(element: {
  readonly children: ArrayLike<object>
}): number {
  const count = element.children.length
  if (count === 0) return 0
  const first = element.children[0] as Placed
  const last = element.children[count - 1] as Placed
  return last.offsetTop + last.offsetHeight - first.offsetTop
}
