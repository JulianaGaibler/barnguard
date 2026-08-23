// One card, drawn whole.
//
// A card is a single `Node2D` that paints its entire face in one `draw`. That is
// deliberate: neither `transform.alpha` nor `visible` cascades in the 2D render
// walk, which iterates a flat per-layer list, so a card built from a parent plus
// child nodes would need every part tweened separately to fade or dim as a unit.
// One node means one tween.
//
// Two levels of detail. Below `DETAIL_MIN_WIDTH` the on-hire and review text are
// dropped and only the portrait, cost, badges and name are drawn. That is a
// legibility call, but it also keeps the live label count clear of the atlas
// cache bound shared with every other string on the stage.

import {
  Node2D,
  easings,
  fitRichTextBlock,
  fitTextBlock,
  ignoreAbort,
  textAdvance,
  textMetrics,
  type Gfx2D,
  type Rect,
  type RichBlock,
} from '@src/stargazer'
import { ANIM, COLORS, GROUP_COLORS } from '../tuning'
import {
  BODY_SIZE_FRACS,
  DETAIL_MIN_WIDTH,
  NAME_SIZE_FRACS,
  cardFace,
  type CardFaceGeom,
} from '../cardFace'
import type { Card } from '../rules/deck'
import { OPEN_SEAT_APPROVALS, OPEN_SEAT_BUDGET } from '../rules/match'
import { abilityFaceSpans, scoringFaceSpans } from '../rules/glyphText'
import {
  drawIcon,
  floorMark,
  groupBadge,
  iconWidth,
  icons,
} from '../../art/icons'
import { drawGlyph, parseGlyph } from '../../art/glyphs'
import { portraitRuns } from '../../art/portraits'
import { FS_STRINGS } from '../../strings'
import { font } from '../../fonts'

/** Names are tight in their box, so the two lines sit closer than body text. */
const NAME_LINE_HEIGHT = 0.95

/**
 * Leading for the two rules bands.
 *
 * A line holding a glyph is exactly as tall as the glyph, since the line box
 * grows to fit what is on it. At `1` that puts a badge on one line hard against
 * the badge on the next, so the bands ask for the air the glyphs leave no room
 * for themselves.
 */
const BODY_LINE_HEIGHT = 1.15

/** How much of a face is left showing under the points it earned. */
const SCORED_PORTRAIT_ALPHA = 0.25

/**
 * How thin a card gets at the halfway point of a turn.
 *
 * Not zero. The height stays at one, so the transform never goes singular, and
 * a hair of width keeps the card from disappearing for a frame on a display
 * that lands the crossing exactly.
 */
const FLIP_EDGE = 0.02

/** What a card slot is showing. */
export type CardFaceKind =
  | {
      kind: 'card'
      card: Card
      budget: number
      /**
       * What each of the card's effects would pay if it were hired now, one
       * entry per effect. Empty for a card that has already resolved.
       */
      pays?: readonly (number | null)[]
    }
  | { kind: 'openSeat' }

export class CardNode extends Node2D {
  #face: CardFaceKind | null = null
  #width = 0
  #height = 0
  /** Raised cards get a stronger shadow and sit in the drag layer. */
  #lifted = false
  #faded = false
  #score: number | null = null
  /** Where the layout wants this card. Motion is measured against it. */
  #home: Rect = { x: 0, y: 0, width: 0, height: 0 }
  #moving = 0
  /**
   * Last frame's device scale, which is what says the portrait may snap.
   *
   * Negative until the card has drawn once. A first frame has nothing to
   * compare against and is almost always at rest, and any zoom worth seeing
   * lasts long enough to be caught on the frame after it starts.
   */
  #lastScale = -1

  constructor(id = 'card') {
    super(id)
  }

  /**
   * Record where the layout wants this card, without moving it there.
   *
   * A card in motion owns its own transform, and nothing re-runs layout when a
   * tween ends, so the target has to be kept somewhere the card can read on the
   * way out. `snapHome` is what takes it.
   */
  setHome(rect: Rect): void {
    this.#home = rect
    this.setSize(rect.width, rect.height)
  }

  get home(): Rect {
    return this.#home
  }

  /** True while a tween owns the transform. */
  get animating(): boolean {
    return this.#moving > 0
  }

  /** Take the home rect now, ending any motion. */
  snapHome(): void {
    this.#moving = 0
    const t = this.transform
    t.x = this.#home.x
    t.y = this.#home.y
    t.scaleX = 1
    t.scaleY = 1
  }

  /**
   * The rect the card actually covers, which is not its home while it is
   * scaled. Hit tests and anything reading a card's position off the board go
   * through this, or a card halfway through a flip answers for the space it
   * will occupy rather than the space it does.
   */
  visualRect(): Rect {
    const t = this.transform
    return {
      x: t.x,
      y: t.y,
      width: this.#width * t.scaleX,
      height: this.#height * t.scaleY,
    }
  }

  /**
   * Run a transform tween, holding the card's centre where the scale would
   * otherwise drag it.
   *
   * `CardNode` draws from its origin with no pivot, so scaling alone grows the
   * card out of its top left corner and a flip turns about its left edge. The
   * centre offset is folded into `x` and `y` for every frame of every verb.
   */
  /**
   * Take ownership of the transform, and hand it back when the returned
   * function is called.
   *
   * A verb holds one claim for all of its legs. Settling per tween would put a
   * two-part turn back at full width the moment its first half reached the
   * edge, which is the whole animation over in half the time.
   */
  #claim(): () => void {
    this.#moving += 1
    return () => {
      this.#moving = Math.max(0, this.#moving - 1)
      // The home rect can have moved under a resize while this was running, so
      // the end of the last leg is where it gets taken.
      if (this.#moving === 0) this.snapHome()
    }
  }

  /** Transform values that place the card at `rect` scaled by `s`. */
  #at(
    rect: Rect,
    s: number,
  ): { x: number; y: number; scaleX: number; scaleY: number } {
    return {
      x: rect.x + (rect.width * (1 - s)) / 2,
      y: rect.y + (rect.height * (1 - s)) / 2,
      scaleX: s,
      scaleY: s,
    }
  }

  /**
   * Transform values for a card `s` of the way through turning, edge on at 0.
   *
   * Only the width goes, so the card keeps its full height and the eye reads a
   * rotation rather than a shrink. Holding the centre is what sells it: the two
   * halves then meet on the same vertical line.
   */
  #atTurn(s: number): { x: number; scaleX: number; scaleY: number } {
    return {
      x: this.#home.x + (this.#home.width * (1 - s)) / 2,
      scaleX: s,
      scaleY: 1,
    }
  }

  /**
   * Grow in where the card was dealt.
   *
   * The start state is written now rather than when the delay expires, or a
   * staggered row shows every card at full size and then shrinks them.
   */
  appear(delay: number): void {
    Object.assign(this.transform, this.#at(this.#home, 0))
    const done = this.#claim()
    void this.tween(this.#at(this.#home, 1), {
      duration: ANIM.dealIn,
      delay,
      easing: easings.outBack,
      key: 'fs-card-move',
    })
      .catch(ignoreAbort)
      .finally(done)
  }

  /**
   * Turn over through the card's own edge, swapping the face at the crossing.
   *
   * The swap runs in a `finally`, because a keyed re-trigger rejects the tween
   * it replaces. A swap sitting on the success path would be skipped and the
   * card left showing a face the board says it is not showing.
   */
  flipTo(face: CardFaceKind): void {
    // Accelerating away and decelerating back is what makes the two halves read
    // as one turn. Matched easings on both would look like a bounce.
    const done = this.#claim()
    void this.tween(this.#atTurn(FLIP_EDGE), {
      duration: ANIM.flipHalf,
      easing: easings.inQuad,
      key: 'fs-card-flip',
    })
      .finally(() => {
        this.setFace(face)
      })
      .then(() =>
        this.tween(this.#atTurn(1), {
          duration: ANIM.flipHalf,
          easing: easings.outQuad,
          key: 'fs-card-flip',
        }),
      )
      .catch(ignoreAbort)
      .finally(done)
  }

  /** Travel to the home rect from somewhere else on the board. */
  travelFrom(rect: Rect): void {
    const s = this.#home.width > 0 ? rect.width / this.#home.width : 1
    Object.assign(this.transform, this.#at(rect, s))
    const done = this.#claim()
    void this.tween(this.#at(this.#home, 1), {
      duration: ANIM.travel,
      easing: easings.outCubic,
      key: 'fs-card-move',
    })
      .catch(ignoreAbort)
      .finally(done)
  }

  /** Take weight, for a card that is already where it belongs. */
  settleIn(): void {
    Object.assign(this.transform, this.#at(this.#home, 1.08))
    const done = this.#claim()
    void this.tween(this.#at(this.#home, 1), {
      duration: ANIM.settle,
      easing: easings.outCubic,
      key: 'fs-card-move',
    })
      .catch(ignoreAbort)
      .finally(done)
  }

  /**
   * Slide off and go.
   *
   * No key: a keyed tween aborts the one it replaces, and `autoDestroy` treats
   * an abort as a reason to destroy, so a keyed exit would take the node out
   * from under its own replacement. A card only ever tosses once, because the
   * board lets go of it before this starts.
   */
  tossOut(drift: number): void {
    this.hitEnabled = false
    const t = this.transform
    void this.autoDestroy(
      this.tween(
        { x: t.x + drift, scaleX: 0.85, scaleY: 0.85, alpha: 0 },
        { duration: ANIM.toss, easing: easings.inCubic },
      ),
    )
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

  /**
   * Push the card back, for a shortlist on the floor that is not in play.
   *
   * This is a veil in the card's own colours rather than `transform.alpha`,
   * because alpha applies per draw call, not to the node's output as a group: a
   * translucent card shows its own portrait disc through the face over it and
   * its badges through the art panel. One veil over the finished face fades the
   * card as a whole, which is what a card at reduced opacity is meant to look
   * like.
   */
  setFaded(faded: boolean): void {
    this.#faded = faded
  }

  /**
   * Show what this seat was worth once the match is scored, or `null` while it
   * is still being played.
   *
   * The figure lands in the portrait disc, over a face dimmed to a quarter. A
   * settled org is read as nine numbers, and the faces are there to say which
   * hire earned which rather than to be read again. Only the portrait dims: the
   * disc behind it stays, so every number sits on the same dark ground and the
   * rest of the card is still legible.
   */
  setScore(score: number | null): void {
    this.#score = score
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
      this.#drawCard(gfx, g, face, w, h, edge)
    }

    if (this.#faded) {
      gfx.fillRoundRect(0, 0, w, h, g.radius, COLORS.fadeVeil)
    }
  }

  /**
   * The seat's points, filling the portrait disc.
   *
   * Sized off the disc rather than the card, then pulled in if the figure is
   * wide enough to touch the edge, which a two-digit score at this weight is.
   */
  #drawScore(gfx: Gfx2D, g: CardFaceGeom): void {
    const d = g.portrait
    const text = String(this.#score)
    let size = d.r * 1.15
    const advance = textAdvance(text, font(800, size))
    const room = d.r * 1.5
    if (advance > room) size *= room / advance
    const f = font(800, size)
    gfx.fillText(text, d.cx, d.cy + textMetrics(text, f).capHeight / 2, {
      font: f,
      align: 'center',
      baseline: 'alphabetic',
      color: COLORS.scoreInk,
    })
  }

  #drawCard(
    gfx: Gfx2D,
    g: CardFaceGeom,
    face: Extract<CardFaceKind, { kind: 'card' }>,
    w: number,
    h: number,
    edge: number,
  ): void {
    const { card, budget } = face
    const stock =
      card.floor === 'management' ? COLORS.stockManagement : COLORS.stockIc
    gfx.fillRoundRect(0, 0, w, h, g.radius, stock)

    this.#drawArtPanel(gfx, g, card)
    this.#drawFloorMark(gfx, g, card)
    this.#drawPortrait(gfx, g, card)
    this.#drawLanyard(gfx, g, w)
    this.#drawCoin(gfx, g, card, w)
    this.#drawBadges(gfx, g, card)
    if (card.sendsMarkerTo) this.#drawElevator(gfx, g)
    this.#drawName(gfx, g, card.name, w)

    if (w >= DETAIL_MIN_WIDTH) {
      gfx.strokeLine(g.divider.x0, g.divider.y, g.divider.x1, g.divider.y, {
        color: COLORS.dividerInk,
        width: Math.max(1, w * 0.006),
      })
      this.#drawOnHire(gfx, g, card, w, face.pays ?? [])
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
   * The portrait, cropped to its disc.
   *
   * The cell snaps to a whole device pixel so all sixteen columns come out the
   * same width. Unsnapped they land on fractions and each row antialiases
   * differently, which reads as noise across a face this small. The origin
   * stays unsnapped: rounding that too is crisper when the card is parked, but
   * makes the portrait crawl while it is dragged, as the sixteen edges cross
   * their thresholds on different frames.
   *
   * The snap is dropped on any frame where the device scale differs from the
   * last one. `snapSize` rounds against that scale, so while it is changing the
   * quantum moves with it and the face climbs in visible steps while everything
   * around it scales smoothly. Reading the scale rather than this node's own
   * transform is what makes it cover a zoom driven by an ancestor or by the
   * camera, neither of which touches the card.
   */
  #drawPortrait(gfx: Gfx2D, g: CardFaceGeom, card: Card): void {
    const box = g.portraitBox
    const scale = gfx.deviceScale()
    const steady =
      this.#lastScale < 0 || Math.abs(scale - this.#lastScale) < 1e-4
    this.#lastScale = scale
    const d = g.portrait
    const cell = steady ? gfx.snapSize(box.width / 16) : box.width / 16
    // Re-centred across, so rounding the cell does not walk the face off the
    // disc. Down the card the grid hangs from its bottom edge instead: the art
    // is drawn cut off at the shoulders, so the row it ends on has to stay
    // welded to the disc.
    const originX = d.cx - cell * 8
    const originY = box.y + box.height - cell * 16
    gfx.save()
    this.#clipToDisc(gfx, d)
    gfx.fillRect(d.cx - d.r, d.cy - d.r, d.r * 2, d.r * 2, COLORS.portraitDisc)
    // Alpha applies per draw call, which is exactly right here: the strips tile
    // the grid rather than overlapping, so a face at a quarter is a quarter
    // everywhere instead of building up where parts meet.
    if (this.#score !== null) gfx.setAlpha(SCORED_PORTRAIT_ALPHA)
    for (const run of portraitRuns(card)) {
      gfx.fillRect(
        originX + run.x * cell,
        originY + run.row * cell,
        run.len * cell,
        cell,
        run.color,
      )
    }
    gfx.restore()
    if (this.#score !== null) this.#drawScore(gfx, g)
  }

  /**
   * Crop to the portrait disc.
   *
   * A circle normally. While the card is squashed for a turn it becomes a
   * capsule, because an analytic circle clip resolves a non-uniform transform
   * to one averaged radius, which shrinks the face in both directions instead
   * of narrowing it with the card. A rounded rect carries its two half extents
   * separately, so it squashes correctly, and at equal scale it is the same
   * circle.
   *
   * The disc is filled inside the clip rather than drawn as its own circle, as
   * it is in the reference art. Two independently anti-aliased circles of the
   * same radius do not composite to one edge. The seam between them shows the
   * card stock through as a hairline ring.
   */
  #clipToDisc(gfx: Gfx2D, d: { cx: number; cy: number; r: number }): void {
    if (!this.#squashed) {
      gfx.setClip({ kind: 'circle', cx: d.cx, cy: d.cy, r: d.r })
      return
    }
    gfx.setClip({
      kind: 'roundRect',
      x: d.cx - d.r,
      y: d.cy - d.r,
      w: d.r * 2,
      h: d.r * 2,
      radius: d.r,
    })
  }

  /** Whether the card is mid-turn, where its two scales differ. */
  get #squashed(): boolean {
    const t = this.transform
    return Math.abs(t.scaleX - t.scaleY) >= 1e-3
  }

  #drawLanyard(gfx: Gfx2D, g: CardFaceGeom, w: number): void {
    const l = g.lanyard
    const r = l.height / 2
    gfx.fillRoundRect(l.x, l.y, l.width, l.height, r, COLORS.lanyard)
    gfx.strokeRoundRect(l.x, l.y, l.width, l.height, r, {
      color: COLORS.cardEdge,
      width: Math.max(1, w * 0.012),
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
    const amount = {
      value: card.cost,
      big: g.coinNumberSize,
      small: g.coinKSize,
    }
    drawAmount(
      gfx,
      amount,
      c.cx - amountWidth(amount) / 2,
      c.cy,
      COLORS.coinInk,
    )
  }

  /**
   * The mark for a card that sends the floor marker across when it is hired.
   *
   * No direction on it, because a card that moves the marker always sends it to
   * the floor the card did not come from.
   */
  #drawElevator(gfx: Gfx2D, g: CardFaceGeom): void {
    const set = icons()
    if (!set) return
    const e = g.elevator
    gfx.drawImage(set.elevator, e.x, e.y, e.width, e.height)
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

  /**
   * The name, over one or two lines, centred in its box.
   *
   * Job titles run long, so the size ladder is tried against a two-line box
   * before anything is cut. Only a title that will not fit even at the smallest
   * size ellipsizes, which `fitTextBlock` reports.
   */
  #drawName(gfx: Gfx2D, g: CardFaceGeom, name: string, w: number): void {
    const sizes = NAME_SIZE_FRACS.map((f) => f * w)
    const block = fitTextBlock(
      name,
      sizes,
      (s) => font(700, s),
      g.nameBox,
      NAME_LINE_HEIGHT,
    )
    const f = font(700, block.size)
    const top = g.nameBox.y + Math.max(0, (g.nameBox.height - block.height) / 2)
    block.lines.forEach((line, i) => {
      gfx.fillText(
        line,
        g.nameBox.x + g.nameBox.width / 2,
        top + block.firstBaselineY + i * block.lineHeight,
        {
          font: f,
          align: 'center',
          baseline: 'alphabetic',
          color: COLORS.ink,
        },
      )
    })
  }

  #drawOnHire(
    gfx: Gfx2D,
    g: CardFaceGeom,
    card: Card,
    w: number,
    pays: readonly (number | null)[],
  ): void {
    const spans = abilityFaceSpans(card, pays)
    if (spans.length === 0) return
    const sizes = BODY_SIZE_FRACS.map((f) => f * w)
    const block = fitRichTextBlock(
      spans,
      sizes,
      (s, bold) => font(bold ? 700 : 500, s),
      g.onHire,
      BODY_LINE_HEIGHT,
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
      scoringFaceSpans(card),
      sizes,
      (s, bold) => font(bold ? 700 : 500, s),
      g.reviewText,
      BODY_LINE_HEIGHT,
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

  /**
   * The face-down card: white stock, generic person, the name it goes by, and
   * the reward for taking it.
   */
  #drawOpenSeat(
    gfx: Gfx2D,
    g: CardFaceGeom,
    w: number,
    h: number,
    edge: number,
  ): void {
    gfx.fillRoundRect(0, 0, w, h, g.radius, COLORS.openSeatStock)
    this.#drawLanyard(gfx, g, w)
    // A generic person: head over shoulders, on its disc. Both go inside the
    // clip, so the shoulders are cropped by the disc rather than running past
    // it, and the disc keeps the same single anti-aliased edge as a portrait.
    const d = g.portrait
    gfx.save()
    this.#clipToDisc(gfx, d)
    gfx.fillRect(d.cx - d.r, d.cy - d.r, d.r * 2, d.r * 2, COLORS.openSeatDisc)
    gfx.fillCircle(d.cx, d.cy - d.r * 0.28, d.r * 0.42, COLORS.personGlyph)
    gfx.fillRoundRect(
      d.cx - d.r * 0.6,
      d.cy + d.r * 0.18,
      d.r * 1.2,
      d.r * 0.7,
      d.r * 0.35,
      COLORS.personGlyph,
    )
    gfx.restore()
    this.#drawName(gfx, g, FS_STRINGS.replacedByAi, w)
    // Reward row, transcribed from the reference: two approval slips, a plus,
    // the budget figure, and a note.
    const set = icons()
    const row = g.openSeatRow
    const u = g.unit
    const cy = row.centerY
    if (set) {
      const slipGap = 4 * u
      const plusGap = 14 * u
      const noteGap = 3 * u
      const approvalW = iconWidth(set.approval, row.approvalHeight)
      const budgetW = iconWidth(set.budget, row.budgetHeight)
      const plusFont = font(700, 16 * u)
      const plusW = textAdvance('+', plusFont)
      const amount = {
        value: OPEN_SEAT_BUDGET,
        big: 19 * u,
        small: 10 * u,
      }
      let x =
        (w -
          (OPEN_SEAT_APPROVALS * approvalW +
            (OPEN_SEAT_APPROVALS - 1) * slipGap +
            plusGap +
            plusW +
            plusGap +
            amountWidth(amount) +
            noteGap +
            budgetW)) /
        2
      for (let i = 0; i < OPEN_SEAT_APPROVALS; i++) {
        if (i > 0) x += slipGap
        x += drawIcon(
          gfx,
          set.approval,
          x,
          cy - row.approvalHeight / 2,
          row.approvalHeight,
        )
      }
      x += plusGap
      gfx.fillText('+', x, cy, {
        font: plusFont,
        align: 'left',
        baseline: 'middle',
        color: COLORS.ink,
      })
      x += plusW + plusGap
      x += drawAmount(gfx, amount, x, cy, COLORS.ink) + noteGap
      drawIcon(gfx, set.budget, x, cy - row.budgetHeight / 2, row.budgetHeight)
    } else {
      gfx.fillText(
        `+${OPEN_SEAT_APPROVALS} approvals, +${OPEN_SEAT_BUDGET}k`,
        w / 2,
        cy,
        {
          font: font(700, 17 * u),
          align: 'center',
          baseline: 'middle',
          color: COLORS.ink,
        },
      )
    }

    gfx.strokeRoundRect(0, 0, w, h, g.radius, {
      color: COLORS.cardEdge,
      width: edge,
    })
  }
}

/**
 * Draw a laid-out rich block inside `box`, vertically centred, each run in its
 * own weight and each glyph in the rect the layout gave it.
 *
 * A box run's `y` is measured from the same baseline the text sits on, so a
 * glyph and the digits beside it come out level. Glyphs take no colour, since
 * `drawImage` has none to take: text follows the ink and artwork does not.
 */
function drawRichBlock(
  gfx: Gfx2D,
  block: RichBlock,
  box: { x: number; y: number; width: number; height: number },
  align: 'left' | 'center',
  color: string,
): void {
  const top = box.y + Math.max(0, (box.height - block.height) / 2)
  const mkFont = (bold: boolean): string => font(bold ? 700 : 500, block.size)
  block.lines.forEach((line, i) => {
    const startX =
      align === 'center' ? box.x + (box.width - line.width) / 2 : box.x
    const y = top + block.firstBaselineY + i * block.lineHeight
    for (const run of line.runs) {
      if (run.kind === 'box') {
        const glyph = parseGlyph(run.box)
        if (glyph) drawGlyph(gfx, glyph, startX + run.x, y + run.y, run.height)
        continue
      }
      gfx.fillText(run.text, startX + run.x, y, {
        font: mkFont(run.bold),
        align: 'left',
        baseline: 'alphabetic',
        color,
      })
    }
  })
}

/** A money figure: a big number with a small "k" sharing one baseline. */
interface Amount {
  value: number
  big: number
  small: number
}

// A hairline only: the advance widths already carry the side bearings.
const amountGap = (a: Amount): number => a.big * 0.02

function amountWidth(a: Amount): number {
  return (
    textAdvance(String(a.value), font(700, a.big)) +
    amountGap(a) +
    textAdvance('k', font(700, a.small))
  )
}

/**
 * Draw `a` with its left edge at `x`, the pair sitting on one baseline and
 * optically centred on `cy` by their capitals.
 *
 * Drawing both runs with `baseline: 'middle'` centres each on its own em box,
 * which puts a 19px numeral and a 10px "k" on two different baselines. They
 * share one here, and the block is centred on cap height rather than the em box
 * so the figure looks level with the icons beside it.
 */
function drawAmount(
  gfx: Gfx2D,
  a: Amount,
  x: number,
  cy: number,
  color: string,
): number {
  const numFont = font(700, a.big)
  const num = textMetrics(String(a.value), numFont)
  const baseline = cy + num.capHeight / 2
  gfx.fillText(String(a.value), x, baseline, {
    font: numFont,
    align: 'left',
    baseline: 'alphabetic',
    color,
  })
  gfx.fillText('k', x + num.advance + amountGap(a), baseline, {
    font: font(700, a.small),
    align: 'left',
    baseline: 'alphabetic',
    color,
  })
  return amountWidth(a)
}
