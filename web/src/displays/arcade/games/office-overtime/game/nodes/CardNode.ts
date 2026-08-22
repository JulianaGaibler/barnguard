// One card, drawn whole.
//
// A card is a single `Node2D` that paints its entire face in one `draw`. That is
// deliberate: neither `transform.alpha` nor `visible` cascades in the 2D render
// walk, which iterates a flat per-layer list, so a card built from a parent plus
// child nodes would need every part tweened separately to fade or dim as a unit.
// One node means one tween.
//
// Two levels of detail. Below `DETAIL_MIN_WIDTH` the on-hire and review text are
// dropped and only the portrait, cost, badges and name are drawn; that is a
// legibility call, but it also keeps the live label count clear of the atlas
// cache bound shared with every other string on the stage.

import {
  Node2D,
  ellipsize,
  fitFontSize,
  fitRichTextBlock,
  textWidth,
  type Gfx2D,
  type RichBlock,
} from '@src/stargazer'
import { COLORS, GROUP_COLORS } from '../tuning'
import {
  BODY_SIZE_FRACS,
  DETAIL_MIN_WIDTH,
  cardFace,
  type CardFaceGeom,
} from '../cardFace'
import type { Card } from '../rules/deck'
import { describeAbilitySpans, describeScoringSpans } from '../rules/text'
import { floorMark, groupBadge, icons } from '../../art/icons'
import { portraitRuns } from '../../art/portraits'

const font = (weight: number, size: number): string =>
  `${weight} ${Math.max(1, size).toFixed(1)}px "Mozilla Text", system-ui, sans-serif`

/** What a card slot is showing. */
export type CardFaceKind =
  { kind: 'card'; card: Card; budget: number } | { kind: 'openSeat' }

export class CardNode extends Node2D {
  #face: CardFaceKind | null = null
  #width = 0
  #height = 0
  /** Raised cards get a stronger shadow and sit in the drag layer. */
  #lifted = false
  #dimmed = false

  constructor(id = 'card') {
    super(id)
  }

  get face(): CardFaceKind | null {
    return this.#face
  }

  setFace(face: CardFaceKind | null): void {
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
  override hitTest(
    worldX: number,
    worldY: number,
    _touchSlopWorld = 0,
  ): boolean {
    if (!this.#face || this.#width <= 0) return false
    const p = this.worldToLocal(worldX, worldY)
    return p.x >= 0 && p.y >= 0 && p.x <= this.#width && p.y <= this.#height
  }

  override draw(gfx: Gfx2D): void {
    const face = this.#face
    if (!face || this.#width <= 0 || this.#height <= 0) return
    const w = this.#width
    const h = this.#height
    const g = cardFace(w, h)
    const edge = Math.max(1, w * 0.012)

    if (this.#lifted) {
      gfx.fillRoundRect(w * 0.02, w * 0.03, w, h, g.radius, COLORS.cardShadow)
    }

    if (face.kind === 'openSeat') {
      this.#drawOpenSeat(gfx, g, w, h, edge)
    } else {
      this.#drawCard(gfx, g, face.card, face.budget, w, h, edge)
    }

    if (this.#dimmed) {
      gfx.fillRoundRect(0, 0, w, h, g.radius, COLORS.dimVeil)
    }
  }

  #drawCard(
    gfx: Gfx2D,
    g: CardFaceGeom,
    card: Card,
    budget: number,
    w: number,
    h: number,
    edge: number,
  ): void {
    const stock =
      card.floor === 'management' ? COLORS.stockManagement : COLORS.stockIc
    gfx.fillRoundRect(0, 0, w, h, g.radius, stock)

    this.#drawArtPanel(gfx, g, card)
    this.#drawFloorMark(gfx, g, card)
    this.#drawPortrait(gfx, g, card)
    this.#drawLanyard(gfx, g, w)
    this.#drawCoin(gfx, g, card, w)
    this.#drawBadges(gfx, g, card)
    this.#drawName(gfx, g, card, w)

    if (w >= DETAIL_MIN_WIDTH) {
      gfx.strokeLine(g.divider.x0, g.divider.y, g.divider.x1, g.divider.y, {
        color: COLORS.dividerInk,
        width: Math.max(1, w * 0.006),
      })
      this.#drawOnHire(gfx, g, card, w)
      this.#drawReview(gfx, g, card, w)
    }

    if (budget > 0) this.#drawStoredBudget(gfx, g, budget, w)

    gfx.strokeRoundRect(0, 0, w, h, g.radius, {
      color: COLORS.cardEdge,
      width: edge,
    })
  }

  #drawArtPanel(gfx: Gfx2D, g: CardFaceGeom, card: Card): void {
    const p = g.artPanel
    const r = g.artRadius
    const g0 = card.groups[0]!
    const g1 = card.groups[1] ?? g0
    const left = GROUP_COLORS[g0].panel
    const right = GROUP_COLORS[g1].panel
    gfx.fillRoundRect(p.x, p.y, p.width, p.height, r, left)
    if (right !== left) {
      const midX = p.x + p.width / 2
      gfx.fillRoundRect(midX, p.y, p.width / 2, p.height, [0, r, r, 0], right)
    }
  }

  #drawFloorMark(gfx: Gfx2D, g: CardFaceGeom, card: Card): void {
    const set = icons()
    if (!set) return
    const m = g.floorMark
    gfx.drawImage(floorMark(set, card.floor), m.x, m.y, m.width, m.height)
  }

  /**
   * The `#3C3C3C` disc, then the portrait's run-length pixel strips clipped to
   * it by the engine's analytic clip — a crisp circular crop with no per-card
   * texture. `save`/`restore` scopes the clip so it can't leak to later parts.
   */
  #drawPortrait(gfx: Gfx2D, g: CardFaceGeom, card: Card): void {
    const d = g.portrait
    gfx.fillCircle(d.cx, d.cy, d.r, COLORS.portraitDisc)
    const box = g.portraitBox
    const cellW = box.width / 16
    const cellH = box.height / 16
    gfx.save()
    gfx.setClip({ kind: 'circle', cx: d.cx, cy: d.cy, r: d.r })
    for (const run of portraitRuns(card)) {
      gfx.fillRect(
        box.x + run.x * cellW,
        box.y + run.row * cellH,
        run.len * cellW,
        cellH,
        run.color,
      )
    }
    gfx.restore()
  }

  #drawLanyard(gfx: Gfx2D, g: CardFaceGeom, w: number): void {
    const l = g.lanyard
    const r = l.height / 2
    gfx.fillRoundRect(l.x, l.y, l.width, l.height, r, COLORS.lanyard)
    gfx.strokeRoundRect(l.x, l.y, l.width, l.height, r, {
      color: COLORS.cardEdge,
      width: Math.max(1, w * 0.006),
    })
  }

  #drawCoin(gfx: Gfx2D, g: CardFaceGeom, card: Card, w: number): void {
    const c = g.coin
    gfx.fillCircle(c.cx, c.cy, c.r, COLORS.coinFill)
    gfx.strokeCircle(c.cx, c.cy, c.r, {
      color: COLORS.coinEdge,
      width: Math.max(1, w * 0.01),
    })
    // Cost reads in thousands, as a big number with a small "k" on one baseline.
    const numStr = String(card.cost)
    const numFont = font(700, g.coinNumberSize)
    const kFont = font(700, g.coinKSize)
    const gap = w * 0.004
    const numW = textWidth(numStr, numFont)
    const kW = textWidth('k', kFont)
    const startX = c.cx - (numW + gap + kW) / 2
    gfx.fillText(numStr, startX, c.cy, {
      font: numFont,
      align: 'left',
      baseline: 'middle',
      color: COLORS.coinInk,
    })
    gfx.fillText('k', startX + numW + gap, c.cy, {
      font: kFont,
      align: 'left',
      baseline: 'middle',
      color: COLORS.coinInk,
    })
  }

  #drawBadges(gfx: Gfx2D, g: CardFaceGeom, card: Card): void {
    const set = icons()
    if (!set) return
    card.groups.forEach((group, i) => {
      const y = g.badgeFirstY + i * g.badgeStepY
      gfx.drawImage(
        groupBadge(set, group),
        g.badgeX,
        y,
        g.badgeSize,
        g.badgeSize,
      )
    })
  }

  #drawName(gfx: Gfx2D, g: CardFaceGeom, card: Card, w: number): void {
    const sizes = [0.092, 0.082, 0.072, 0.063, 0.056].map((f) => f * w)
    const size = fitFontSize(
      card.name,
      sizes,
      (s) => font(700, s),
      g.nameMaxWidth,
    )
    const f = font(700, size)
    gfx.fillText(
      ellipsize(card.name, f, g.nameMaxWidth),
      g.nameCenterX,
      g.nameBaselineY,
      {
        font: f,
        align: 'center',
        baseline: 'alphabetic',
        color: COLORS.ink,
      },
    )
  }

  #drawOnHire(gfx: Gfx2D, g: CardFaceGeom, card: Card, w: number): void {
    const spans = describeAbilitySpans(card)
    if (spans.length === 0) return
    const sizes = BODY_SIZE_FRACS.map((f) => f * w)
    const block = fitRichTextBlock(
      spans,
      sizes,
      (s, bold) => font(bold ? 700 : 500, s),
      g.onHire,
    )
    drawRichBlock(gfx, block, g.onHire, 'center', COLORS.ink)
  }

  #drawReview(gfx: Gfx2D, g: CardFaceGeom, card: Card, w: number): void {
    const bnd = g.reviewBand
    gfx.fillRoundRect(
      bnd.x,
      bnd.y,
      bnd.width,
      bnd.height,
      g.reviewRadius,
      COLORS.reviewBand,
    )
    const chip = g.pointsChip
    gfx.fillRoundRect(
      chip.x,
      chip.y,
      chip.width,
      chip.height,
      [g.reviewRadius, 0, 0, g.reviewRadius],
      COLORS.reviewChip,
    )
    gfx.fillText(
      String(card.scoring.points),
      chip.x + chip.width / 2,
      chip.y + chip.height / 2,
      {
        font: font(800, chip.height * 0.5),
        align: 'center',
        baseline: 'middle',
        color: COLORS.reviewChipInk,
      },
    )
    const sizes = BODY_SIZE_FRACS.map((f) => f * w)
    const block = fitRichTextBlock(
      describeScoringSpans(card),
      sizes,
      (s, bold) => font(bold ? 700 : 500, s),
      g.reviewText,
    )
    drawRichBlock(gfx, block, g.reviewText, 'left', COLORS.ink)
  }

  #drawStoredBudget(
    gfx: Gfx2D,
    g: CardFaceGeom,
    budget: number,
    w: number,
  ): void {
    const p = g.artPanel
    const r = w * 0.09
    const cx = p.x + p.width - r
    const cy = p.y + p.height - r
    gfx.fillCircle(cx, cy, r, COLORS.budget)
    gfx.fillText(`${budget}k`, cx, cy, {
      font: font(700, r * 0.85),
      align: 'center',
      baseline: 'middle',
      color: '#ffffff',
    })
  }

  /** The face-down card: white stock, generic person, and the open-seat reward. */
  #drawOpenSeat(
    gfx: Gfx2D,
    g: CardFaceGeom,
    w: number,
    h: number,
    edge: number,
  ): void {
    gfx.fillRoundRect(0, 0, w, h, g.radius, COLORS.openSeatStock)
    this.#drawLanyard(gfx, g, w)
    const d = g.portrait
    gfx.fillCircle(d.cx, d.cy, d.r, COLORS.openSeatDisc)
    // A generic person: head over shoulders, in the reference's soft glyph tone.
    gfx.fillCircle(d.cx, d.cy - d.r * 0.28, d.r * 0.42, COLORS.personGlyph)
    gfx.fillRoundRect(
      d.cx - d.r * 0.6,
      d.cy + d.r * 0.18,
      d.r * 1.2,
      d.r * 0.7,
      d.r * 0.35,
      COLORS.personGlyph,
    )
    // Reward row, centred where the review band sits: +6k budget, +2 approvals.
    const set = icons()
    const bnd = g.reviewBand
    const cy = bnd.y + bnd.height / 2
    const iconH = bnd.height * 0.7
    const textFont = font(700, bnd.height * 0.42)
    const label = '+6k  +2'
    if (set) {
      const budgetW = iconH * 0.7
      const approvalW = iconH * 0.7
      const labelW = textWidth(label, textFont)
      const gap = w * 0.02
      const total = budgetW + gap + labelW + gap + approvalW
      let x = bnd.x + (bnd.width - total) / 2
      gfx.drawImage(set.budget, x, cy - iconH / 2, budgetW, iconH)
      x += budgetW + gap
      gfx.fillText(label, x, cy, {
        font: textFont,
        align: 'left',
        baseline: 'middle',
        color: COLORS.ink,
      })
      x += labelW + gap
      gfx.drawImage(set.approval, x, cy - iconH / 2, approvalW, iconH)
    } else {
      gfx.fillText('+6k, +2 approvals', bnd.x + bnd.width / 2, cy, {
        font: textFont,
        align: 'center',
        baseline: 'middle',
        color: COLORS.ink,
      })
    }

    gfx.strokeRoundRect(0, 0, w, h, g.radius, {
      color: COLORS.cardEdge,
      width: edge,
    })
  }
}

/**
 * Draw a laid-out rich block inside `box`, vertically centred, each run in its
 * own weight.
 */
function drawRichBlock(
  gfx: Gfx2D,
  block: RichBlock,
  box: { x: number; y: number; width: number; height: number },
  align: 'left' | 'center',
  color: string,
): void {
  const totalH = block.lines.length * block.lineHeight
  let y = box.y + Math.max(0, (box.height - totalH) / 2)
  const mkFont = (bold: boolean): string => font(bold ? 700 : 500, block.size)
  for (const line of block.lines) {
    const startX =
      align === 'center' ? box.x + (box.width - line.width) / 2 : box.x
    for (const run of line.runs) {
      gfx.fillText(run.text, startX + run.x, y, {
        font: mkFont(run.bold),
        align: 'left',
        baseline: 'top',
        color,
      })
    }
    y += block.lineHeight
  }
}
