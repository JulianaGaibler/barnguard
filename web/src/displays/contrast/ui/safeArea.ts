/** Space kept clear on each edge, such as for a notch or a home indicator. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

let probe: HTMLElement | null = null

/**
 * The device's safe area insets in CSS pixels. All zero on a screen without a
 * notch, and outside a browser. Needs `viewport-fit=cover` in the viewport meta
 * tag, which `index.html` sets.
 */
export function readSafeArea(): Insets {
  if (typeof document === 'undefined' || !document.body) return NO_INSETS
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;inset:0 auto auto 0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
      'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
    document.body.append(probe)
  }
  const style = getComputedStyle(probe)
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  }
}

/** `insets` in another unit, `scale` of them to a CSS pixel. */
export function scaleInsets(insets: Insets, scale: number): Insets {
  return {
    top: insets.top * scale,
    right: insets.right * scale,
    bottom: insets.bottom * scale,
    left: insets.left * scale,
  }
}

function px(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}
