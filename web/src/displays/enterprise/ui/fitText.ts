/**
 * Svelte action that shrinks an element's font size until its text fits on one
 * line within `width`, from `max` down to `min` in 2 px steps. Re-fits when the
 * text or the limits change.
 *
 * @example
 *   <h2 use:fitText={{ text: name, width: 412, max: 64, min: 36 }}>{name}</h2>
 */
export interface FitTextParams {
  /** The text shown, so the action knows when to fit again. */
  text: string
  width: number
  max: number
  min: number
}

export function fitText(
  node: HTMLElement,
  params: FitTextParams,
): { update(next: FitTextParams): void } {
  function fit(p: FitTextParams): void {
    let size = p.max
    node.style.fontSize = `${size}px`
    while (size > p.min && node.scrollWidth > p.width) {
      size -= 2
      node.style.fontSize = `${size}px`
    }
  }
  fit(params)
  return {
    update(next) {
      fit(next)
    },
  }
}
