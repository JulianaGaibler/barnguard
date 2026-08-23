import { describe, expect, it } from 'vitest'
import {
  boothCornerInset,
  coverView,
  gameVisibleRect,
  launcherVisibleRect,
  PREVIEW_BLEED_BUDGET_FRAC,
  REGION_HEIGHT,
  REGION_WIDTH,
  updateLayout,
  worldPerCssPx,
} from './world'
import { DC_PREVIEW_BLEED_FRAC } from './games/data-control/game/menuPreview'
import {
  BOOTH_CORNER_SIZE_PX,
  initBoothMenuToggle,
} from '@src/core/attendant/boothMenuToggle'

describe('worldPerCssPx', () => {
  it('is 1 at the region design size', () => {
    expect(worldPerCssPx(REGION_WIDTH, REGION_HEIGHT)).toBe(1)
  })

  it('grows as the canvas shrinks', () => {
    // A fixed on-screen box covers more of the region on a smaller canvas, so
    // anything clearing it has to clear more world units.
    expect(worldPerCssPx(REGION_WIDTH / 2, REGION_HEIGHT / 2)).toBe(2)
    expect(worldPerCssPx(REGION_WIDTH * 2, REGION_HEIGHT * 2)).toBe(0.5)
  })

  it('follows the letterboxed axis, matching gameVisibleRect', () => {
    // The region is fit aspect-preserving, so the scale comes from whichever
    // axis is the tighter fit. Both must agree or chrome placed with one drifts
    // from bounds computed with the other.
    for (const [w, h] of [
      [1600, 1200],
      [2400, 900],
      [1080, 1920],
    ]) {
      const view = gameVisibleRect(w!, h!)
      expect(worldPerCssPx(w!, h!)).toBeCloseTo(view.width / w!, 10)
      expect(worldPerCssPx(w!, h!)).toBeCloseTo(view.height / h!, 10)
    }
  })

  it('falls back to 1 on a degenerate canvas', () => {
    expect(worldPerCssPx(0, 0)).toBe(1)
  })
})

describe('boothCornerInset', () => {
  it('just clears the gesture box at the region design size', () => {
    expect(boothCornerInset(REGION_WIDTH, REGION_HEIGHT)).toBeGreaterThan(
      BOOTH_CORNER_SIZE_PX,
    )
    expect(boothCornerInset(REGION_WIDTH, REGION_HEIGHT)).toBeLessThan(
      BOOTH_CORNER_SIZE_PX * 1.1,
    )
  })

  /**
   * Dispatch a `pointerdown` at a world point and report whether it survived
   * the booth gesture.
   *
   * The gesture swallows corner taps with `stopImmediatePropagation` at capture
   * phase, so a later window listener firing is exactly the thing game chrome
   * needs and the thing it was denied. Driving the real listener is the point:
   * the arithmetic on its own is self-consistent either way, so only the two
   * halves meeting proves anything.
   */
  function tapSurvives(
    cssW: number,
    cssH: number,
    world: { x: number; y: number },
  ): boolean {
    Object.defineProperty(window, 'innerWidth', {
      value: cssW,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: cssH,
      configurable: true,
    })
    const view = gameVisibleRect(cssW, cssH)
    const perCss = worldPerCssPx(cssW, cssH)
    const teardown = initBoothMenuToggle()
    let arrived = false
    const listener = (): void => void (arrived = true)
    window.addEventListener('pointerdown', listener)
    try {
      window.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: (world.x - view.x) / perCss,
          clientY: (world.y - view.y) / perCss,
          bubbles: true,
          cancelable: true,
        }),
      )
    } finally {
      window.removeEventListener('pointerdown', listener)
      teardown()
    }
    return arrived
  }

  const SIZES = [
    [1920, 1080],
    [1280, 720],
    [1024, 576],
    [3840, 2160],
    [1080, 1920],
    [2400, 900],
  ] as const

  it('clears the gesture when spent on the horizontal axis', () => {
    for (const [cssW, cssH] of SIZES) {
      const view = gameVisibleRect(cssW, cssH)
      const inset = boothCornerInset(cssW, cssH)
      const x = view.x + view.width - inset
      expect(tapSurvives(cssW, cssH, { x, y: view.y })).toBe(true)
    }
  })

  it('clears the gesture when spent on the vertical axis', () => {
    for (const [cssW, cssH] of SIZES) {
      const view = gameVisibleRect(cssW, cssH)
      const inset = boothCornerInset(cssW, cssH)
      const y = view.y + inset
      expect(tapSurvives(cssW, cssH, { x: view.x + view.width, y })).toBe(true)
    }
  })

  it('is not clearance to spare: one pixel less is still swallowed', () => {
    // Guards against the inset drifting upward and quietly hiding a real
    // regression behind slack.
    for (const [cssW, cssH] of SIZES) {
      const view = gameVisibleRect(cssW, cssH)
      const perCss = worldPerCssPx(cssW, cssH)
      const inset = boothCornerInset(cssW, cssH) - perCss
      const x = view.x + view.width - inset
      expect(tapSurvives(cssW, cssH, { x, y: view.y })).toBe(false)
    }
  })
})

describe('region separation vs menu backdrop bleed', () => {
  const SIZES = [
    [1920, 1080],
    [1280, 720],
    [1024, 576],
    [2560, 1080],
    [3440, 1440],
    [1080, 1920],
    [2400, 900],
  ] as const

  it('keeps a backdrop spending its whole bleed budget out of the launcher', () => {
    // A menu backdrop may draw past its own cover rect on purpose. The sky band
    // between the regions is what has to swallow it: over-draw that reaches the
    // launcher's visible rect is seen from the launcher, hanging into it and
    // popping in and out as the cull rect catches it.
    for (const [w, h] of SIZES) {
      updateLayout(w, h)
      const cover = coverView(
        gameVisibleRect(w, h),
        REGION_WIDTH / REGION_HEIGHT,
      )
      const reach =
        cover.y + cover.height + cover.height * PREVIEW_BLEED_BUDGET_FRAC
      expect(reach).toBeLessThan(launcherVisibleRect(w, h).y)
    }
  })

  it('keeps the shipped backdrop inside the budget', () => {
    // The one backdrop that stages elements outside its rect. If its staging
    // band or its spawn burst grows, this is the thing that should fail rather
    // than the launcher quietly showing packets again.
    expect(DC_PREVIEW_BLEED_FRAC).toBeLessThanOrEqual(PREVIEW_BLEED_BUDGET_FRAC)
    expect(DC_PREVIEW_BLEED_FRAC).toBeGreaterThan(0)
  })
})
