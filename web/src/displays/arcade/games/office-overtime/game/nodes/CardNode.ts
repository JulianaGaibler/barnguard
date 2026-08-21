// One card, drawn whole.
//
// A card is a single `Node2D` that paints its entire face in one `draw`. That
// is deliberate: neither `transform.alpha` nor `visible` cascades in the 2D
// render walk, which iterates a flat per-layer list, so a card built from a
// parent plus child text nodes would need every part tweened separately to fade
// as a unit. One node means one tween.
//
// Two levels of detail. Below `CARD.detailMinWidth` only the cost, the group
// shields and the name are drawn; the ability and review text appear on the
// candidates and on whichever card has focus. That is a legibility call first,
// but it also keeps the live label count clear of the atlas cache bound, which
// is shared with every other string on the stage.

import {
  Node2D,
  ellipsize,
  fitFontSize,
  fitTextBlock,
  type Gfx2D,
} from '@src/stargazer'
import { CARD, COLORS, GROUP_COLORS } from '../tuning'
import type { Card, Group } from '../rules/deck'
import { describeAbility, describeScoring } from '../rules/text'

const font = (weight: number, size: number): string =>
  `${weight} ${size.toFixed(1)}px "Mozilla Text", system-ui, sans-serif`

/** What a card slot is showing. */
export type CardFace =
  | { kind: 'card'; card: Card; budget: number }
  | { kind: 'openSeat' }
  | { kind: 'back'; floor: 'management' | 'ic' }

/**
 * Where the name sits on the ribbon and how far it is turned.
 *
 * Pulled out of the draw so the reading direction can be asserted without a
 * GPU. The rotation has to carry the text advance direction (1, 0) onto (0, 1),
 * which runs the name down the card.
 */
export function ribbonTextAnchor(
  width: number,
  height: number,
): { x: number; y: number; rotation: number } {
  return {
    x: width * CARD.ribbonWidthFrac * 0.5,
    y: height * CARD.ribbonTextTopFrac,
    rotation: CARD.nameRotation,
  }
}

export class CardNode extends Node2D {
  #face: CardFace | null = null
  #width = 0
  #height = 0
  /** Raised cards get a stronger shadow and sit in the drag layer. */
  #lifted = false
  #dimmed = false

  constructor(id = 'card') {
    super(id)
  }

  get face(): CardFace | null {
    return this.#face
  }

  setFace(face: CardFace | null): void {
    this.#face = face
  }

  setLifted(lifted: boolean): void {
    this.#lifted = lifted
  }

  setDimmed(dimmed: boolean): void {
    this.#dimmed = dimmed
  }

  get width(): number {
    return this.#width
  }

  get height(): number {
    return this.#height
  }

  /**
   * Size the card. Bounds cover the drawn extent rather than the card rect,
   * because declaring bounds also opts the node into viewport culling and the
   * shadow reaches past the edge.
   */
  setSize(width: number, height: number): void {
    this.#width = width
    this.#height = height
    const bleed = Math.max(4, width * 0.06)
    this.debugBounds = {
      x: -bleed,
      y: -bleed,
      width: width + bleed * 2,
      height: height + bleed * 2,
    }
  }

  /** Local-space hit test against the card rect. */
  override hitTest(worldX: number, worldY: number): boolean {
    if (!this.#face || this.#width <= 0) return false
    const p = this.worldToLocal(worldX, worldY)
    return p.x >= 0 && p.y >= 0 && p.x <= this.#width && p.y <= this.#height
  }

  override draw(gfx: Gfx2D): void {
    const face = this.#face
    if (!face || this.#width <= 0 || this.#height <= 0) return
    const w = this.#width
    const h = this.#height
    const r = w * CARD.cornerFrac

    if (this.#lifted) {
      gfx.fillRoundRect(3, 6, w, h, r, COLORS.cardShadow)
    }

    if (face.kind === 'openSeat') {
      this.#drawOpenSeat(gfx, w, h, r)
      return
    }
    if (face.kind === 'back') {
      const stock =
        face.floor === 'management' ? COLORS.ribbonManagement : COLORS.ribbonIc
      gfx.fillRoundRect(0, 0, w, h, r, stock)
      gfx.strokeRoundRect(0, 0, w, h, r, {
        color: COLORS.cardEdge,
        width: Math.max(1, w * 0.012),
      })
      return
    }

    const card = face.card
    const stock =
      card.floor === 'management' ? COLORS.stockManagement : COLORS.stockIc
    gfx.fillRoundRect(0, 0, w, h, r, stock)

    this.#drawRibbon(gfx, card, w, h, r)
    this.#drawArt(gfx, card, w, h)
    const detailed = w >= CARD.detailMinWidth
    if (detailed) this.#drawDetail(gfx, card, w, h)
    this.#drawCoin(gfx, card, w)
    this.#drawGroups(gfx, card, w)
    if (face.budget > 0) this.#drawStoredBudget(gfx, face.budget, w, h)

    gfx.strokeRoundRect(0, 0, w, h, r, {
      color: COLORS.cardEdge,
      width: Math.max(1, w * 0.012),
    })
    if (this.#dimmed) gfx.fillRoundRect(0, 0, w, h, r, '#0f0d0a66')
  }

  #drawOpenSeat(gfx: Gfx2D, w: number, h: number, r: number): void {
    gfx.fillRoundRect(0, 0, w, h, r, COLORS.openSeat)
    gfx.strokeRoundRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8, r * 0.6, {
      color: '#00000033',
      width: Math.max(1, w * 0.02),
      dash: [w * 0.06, w * 0.05],
    })
  }

  /** The floor stripe down the left edge, carrying the card's name. */
  #drawRibbon(gfx: Gfx2D, card: Card, w: number, h: number, r: number): void {
    const rw = w * CARD.ribbonWidthFrac
    const color =
      card.floor === 'management' ? COLORS.ribbonManagement : COLORS.ribbonIc
    gfx.fillRoundRect(0, 0, rw, h, [r, 0, 0, r], color)

    // The name reads top to bottom, as on the printed cards: glyphs turned a
    // quarter turn clockwise, starting clear of the cost coin that overlaps the
    // top of the ribbon. A quarter turn the other way runs the text upward and
    // reads as though the ribbon were flipped end for end.
    const anchor = ribbonTextAnchor(w, h)
    const run = h * CARD.ribbonTextBottomFrac - anchor.y
    const size = fitFontSize(
      card.name,
      [w * 0.1, w * 0.09, w * 0.08, w * 0.07],
      (s) => font(600, s),
      run,
    )
    const f = font(600, size)
    gfx.save()
    gfx.translate(anchor.x, anchor.y)
    gfx.rotate(anchor.rotation)
    gfx.fillText(ellipsize(card.name, f, run), 0, 0, {
      font: f,
      align: 'left',
      baseline: 'middle',
      color: COLORS.paper,
    })
    gfx.restore()
  }

  /** Placeholder art panel in the card's primary group colour. */
  #drawArt(gfx: Gfx2D, card: Card, w: number, h: number): void {
    const x = w * CARD.ribbonWidthFrac + w * 0.04
    const y = h * CARD.artTopFrac
    const aw = w - x - w * 0.06
    const ah = h * (CARD.artBottomFrac - CARD.artTopFrac)
    const primary = card.groups[0] as Group
    gfx.fillRoundRect(x, y, aw, ah, w * 0.03, GROUP_COLORS[primary] + '33')
    gfx.fillRoundRect(
      x,
      y + ah * 0.62,
      aw,
      ah * 0.38,
      w * 0.03,
      GROUP_COLORS[primary] + '22',
    )
  }

  /**
   * The on-hire ability and the performance review.
   *
   * Both blocks pick the largest size that fits their band whole. Truncating
   * either one makes the card unreadable: the ability is what the card does on
   * the turn it is taken, and the review is the only statement of how it
   * scores.
   */
  #drawDetail(gfx: Gfx2D, card: Card, w: number, h: number): void {
    const x = w * CARD.ribbonWidthFrac + w * 0.04
    const aw = w - x - w * 0.05
    const sizes = CARD.bodySizeFracs.map((f) => f * w)
    const mkFont = (size: number) => font(400, size)

    const ability = describeAbility(card)
    if (ability) {
      const band = {
        width: aw,
        height: h * (CARD.abilityBottomFrac - CARD.abilityTopFrac),
      }
      const block = fitTextBlock(ability, sizes, mkFont, band)
      block.lines.forEach((line, i) => {
        gfx.fillText(line, x, h * CARD.abilityTopFrac + i * block.lineHeight, {
          font: mkFont(block.size),
          align: 'left',
          baseline: 'top',
          color: COLORS.inkSoft,
        })
      })
    }

    // The review sits on a paper scroll, as on the printed cards.
    const sy = h * CARD.reviewTopFrac
    const sh = h * (CARD.reviewBottomFrac - CARD.reviewTopFrac)
    gfx.fillRoundRect(
      x - w * 0.02,
      sy,
      aw + w * 0.04,
      sh,
      w * 0.03,
      COLORS.paper,
    )

    const sealR = Math.min(sh * 0.28, w * 0.1)
    const cx = x + sealR * 0.6
    const cy = sy + sh * 0.5
    gfx.fillCircle(cx, cy, sealR, COLORS.seal)
    gfx.fillText(String(card.scoring.points), cx, cy, {
      font: font(700, sealR * 1.2),
      align: 'center',
      baseline: 'middle',
      color: COLORS.paper,
    })

    const tx = cx + sealR * 1.35
    const band = {
      width: x + aw + w * 0.02 - tx,
      height: sh * 0.86,
    }
    const block = fitTextBlock(describeScoring(card), sizes, mkFont, band)
    const top = cy - (block.lines.length * block.lineHeight) / 2
    block.lines.forEach((line, i) => {
      gfx.fillText(line, tx, top + i * block.lineHeight, {
        font: mkFont(block.size),
        align: 'left',
        baseline: 'top',
        color: COLORS.ink,
      })
    })
  }

  #drawCoin(gfx: Gfx2D, card: Card, w: number): void {
    const rad = w * CARD.coinRadiusFrac
    const cx = rad * 0.95
    const cy = rad * 0.85
    gfx.fillCircle(cx, cy, rad, COLORS.coin)
    gfx.strokeCircle(cx, cy, rad, {
      color: COLORS.coinEdge,
      width: Math.max(1, w * 0.014),
    })
    gfx.fillText(String(card.cost), cx, cy, {
      font: font(700, rad * 1.25),
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }

  /** Group shields, hanging from the top-right corner. */
  #drawGroups(gfx: Gfx2D, card: Card, w: number): void {
    const sw = w * CARD.shieldWidthFrac
    const sh = sw * 1.12
    let y = sw * 0.14
    for (const group of card.groups) {
      const x = w - sw - w * 0.05
      shield(gfx, x, y, sw, sh, GROUP_COLORS[group])
      y += sh * 0.82
    }
  }

  #drawStoredBudget(gfx: Gfx2D, budget: number, w: number, h: number): void {
    const rad = w * 0.13
    const cx = w - rad * 1.1
    const cy = h - rad * 1.1
    gfx.fillCircle(cx, cy, rad, COLORS.budget)
    gfx.fillText(String(budget), cx, cy, {
      font: font(700, rad * 1.1),
      align: 'center',
      baseline: 'middle',
      color: COLORS.paper,
    })
  }
}

/** A heraldic shield: square shoulders tapering to a point. */
function shield(
  gfx: Gfx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const pts = [
    x,
    y,
    x + w,
    y,
    x + w,
    y + h * 0.6,
    x + w * 0.5,
    y + h,
    x,
    y + h * 0.6,
  ]
  gfx.fillConvexPoly(pts, 5, color)
}
