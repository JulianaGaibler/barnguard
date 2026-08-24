/**
 * The backdrop behind the menu: the monster, being fed.
 *
 * @remarks
 *   Cards drift down out of the top of the frame and disappear into the mouth.
 *   Nothing here reads the session, and nothing is clipped per card: the face
 *   is drawn last, so a card passes behind the buttons and is simply gone once
 *   it reaches the opening. That is also why the fall columns are bounded by
 *   the opening rather than the frame, since a card coming down beside the
 *   monster would land on the floor instead of being eaten.
 *
 *   Flat art rather than the game's own 3D table. The shared sky draws over the
 *   whole 3D pass while the menu is up, so a table here would have to fight it,
 *   and a picture of the monster says what the game is faster than a table seen
 *   from above.
 * @example
 *   const preview = buildMonstersIntMenuPreview(
 *     host,
 *     coverView(rect, 16 / 9),
 *     rect,
 *   )
 *   preview.destroy()
 */
import {
  easings,
  Node2D,
  type EngineHost,
  type Gfx2D,
  type Rect,
} from '@src/stargazer'
import { seededRandom } from '../../common/rng'
import type { MenuPreview } from '../../../menu/types'
import { loadCardImages, type CardImages } from './art/cardTextures'
import {
  loadMenuFace,
  MENU_FACE_ASPECT,
  MENU_MOUTH,
  type MenuFace,
} from './art/menuArt'
import { buildDeck, faceOf } from './rules/cards'
import { COLORS } from './tuning'

/**
 * Cards in the air at once.
 *
 * Two. This is a backdrop behind a menu somebody is reading, so it wants to be
 * noticed once and then ignored, and a stream busy enough to count is a stream
 * that competes with the buttons.
 */
const COUNT = 2
/** Seconds one card takes to fall from the top of the frame into the mouth. */
const FALL_SECONDS = 28
/** Share of the frame's width taken by the monster, who sits against its right. */
const FACE_WIDTH_FRAC = 0.56
/** A card's width, against the monster's. */
const CARD_WIDTH_FRAC = 0.112
/** A card is taller than it is wide by this much, from the art. */
const CARD_ASPECT = 194 / 128
/**
 * How much of the opening's width the fall columns use.
 *
 * Bounded by the rim rather than by taste. The opening is an ellipse, so its
 * lip drops away toward the corners, and a card coming down out there is still
 * poking above the lip at the depth {@link SINK} stops it at. Cards land down
 * the middle of the mouth, which is where a mouth swallows anyway.
 */
const SPREAD = 0.58
/** How far a card may lean, in radians. */
const TILT = 0.22
/**
 * How far into the opening a card sinks before it goes, 0 at the rim and 1 at
 * the middle of the mouth.
 *
 * Far enough that the whole card is inside before it wraps. Every face is
 * printed on the same ink the mouth is, so a card at this depth has already
 * disappeared into it and needs no fading out to leave.
 */
const SINK = 0.85

/**
 * Every face in the deck, in deck order, built once.
 *
 * Drawing from this rather than from the list of artwork files is what weights
 * the stream the way the deck is weighted: mostly high numbers, an action card
 * now and then, one lonely zero.
 */
const DECK_FACES: readonly string[] = buildDeck().map((c) => faceOf(c.card))

/**
 * Where a card ends up when its fall runs out, in fractions of the monster's
 * drawn height, together with the lip it has to be under by then.
 *
 * Pulled out because the constants above are not independent: a taller card, a
 * shallower {@link SINK} or a wider {@link SPREAD} can each leave the outermost
 * card still poking over the lip when it wraps, which reads as a card blinking
 * out in mid-air. `menuPreview.test.ts` holds the three to each other.
 */
export function swallow(): {
  /** Centre of the card at the end of its fall. */
  center: number
  top: number
  bottom: number
  /** The lip under the outermost fall column, which is its highest point. */
  outerRim: number
} {
  const cardHeight = CARD_WIDTH_FRAC * CARD_ASPECT * MENU_FACE_ASPECT
  const center = MENU_MOUTH.centerYFrac - MENU_MOUTH.halfHeightFrac * (1 - SINK)
  return {
    center,
    top: center - cardHeight / 2,
    bottom: center + cardHeight / 2,
    outerRim:
      MENU_MOUTH.centerYFrac -
      MENU_MOUTH.halfHeightFrac * Math.sqrt(1 - SPREAD * SPREAD),
  }
}

interface Faller {
  /** Which face it shows, drawn from the real deck so the mix is the deck's. */
  face: string
  /** Across the opening, -1 to 1. */
  lane: number
  /** Progress down the fall, 0 to 1, wrapping. */
  t: number
  tilt: number
  /** Radians per second, slow enough to read as drifting rather than spinning. */
  turn: number
}

class MenuPreviewNode extends Node2D {
  readonly #view: Rect
  readonly #region: Rect
  readonly #fallers: Faller[] = []
  /**
   * Seeded, and kept, so the whole sequence is the same every time the booth
   * opens the menu rather than subtly different on each visit.
   */
  readonly #random = seededRandom(0x30071e)
  #images: CardImages | null = null
  #face: MenuFace | null = null
  #elapsed = 0

  constructor(view: Rect, region: Rect) {
    super('monsters-int-menu-preview')
    // Above the shared sky, which draws in the `static` layer over the whole
    // 3D pass. A preview below it would never be seen.
    this.renderLayer = 'dynamic'
    this.#view = view
    this.#region = region

    const random = this.#random
    for (let i = 0; i < COUNT; i++) {
      this.#fallers.push({
        face: this.#nextFace(),
        lane: random() * 2 - 1,
        // Evenly spaced down the fall, and every card falls at the same rate.
        // Varying the rate looks livelier for a few seconds and then bunches
        // them, because a faster card eventually catches the one in front.
        t: i / COUNT,
        tilt: (random() * 2 - 1) * TILT,
        turn: (random() * 2 - 1) * 0.25,
      })
    }
    this.debugBounds = { ...view }
  }

  #nextFace(): string {
    return DECK_FACES[Math.floor(this.#random() * DECK_FACES.length)]!
  }

  /** Art arrives after the menu is already up, so the node is built without it. */
  setArt(images: CardImages, face: MenuFace): void {
    this.#images = images
    this.#face = face
  }

  override onUpdate(dt: number): void {
    this.#elapsed += dt
    for (const f of this.#fallers) {
      f.t += dt / FALL_SECONDS
      if (f.t < 1) continue
      f.t -= 1
      // A new face and a new lane on the way round, so the stream never settles
      // into a loop the eye can pick out.
      f.face = this.#nextFace()
      f.lane = this.#random() * 2 - 1
    }
  }

  override draw(gfx: Gfx2D): void {
    const r = this.#region
    gfx.save()
    // Clipped to the region rather than to the cover rect. The cover rect
    // overflows on purpose so the wash has no visible edge, and without this
    // the overflow hangs into the launcher and shows during the pan.
    gfx.setClip({
      kind: 'roundRect',
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      radius: 0,
    })
    // The table's own surface. The shared sky spans both regions, so something
    // in here has to paint over it.
    const v = this.#view
    gfx.fillRect(v.x, v.y, v.width, v.height, COLORS.cream)

    const face = this.#face
    if (face) {
      const w = r.width * FACE_WIDTH_FRAC
      const h = w / face.aspect
      const x = r.x + r.width - w
      const y = r.y + r.height - h
      gfx.drawImage(face.image, x, y, w, h)
      // Over the monster rather than behind him, so a card is its own object
      // for the whole fall. What eats it is a clip at the rim of the opening,
      // set per card in `#drawFallers`.
      this.#drawFallers(gfx, x, y, w, h)
    }
    gfx.restore()
  }

  /**
   * The stream, aimed down the opening of the face drawn at `(x, y, w, h)`.
   *
   * Over the monster and under nothing but the region clip already in force, so
   * a card is its own object for the whole fall. What ends it is the dark: the
   * fall carries on until the card is inside the opening, which is printed in
   * the same ink the faces are, so it is gone before it wraps.
   */
  #drawFallers(gfx: Gfx2D, x: number, y: number, w: number, h: number): void {
    const images = this.#images
    if (!images) return
    const cardW = w * CARD_WIDTH_FRAC
    const cardH = cardW * CARD_ASPECT
    const centerX = x + w * MENU_MOUTH.centerXFrac
    const half = w * MENU_MOUTH.halfWidthFrac * SPREAD
    const from = this.#region.y - cardH
    const to = y + h * swallow().center

    for (const f of this.#fallers) {
      const image = images[f.face]
      if (!image) continue
      gfx.save()
      gfx.translate(centerX + f.lane * half, from + f.t * (to - from))
      gfx.rotate(f.tilt + f.turn * this.#elapsed)
      gfx.drawImage(image, -cardW / 2, -cardH / 2, cardW, cardH)
      gfx.restore()
    }
  }
}

/**
 * Build the backdrop over `view`, clipped to `region`.
 *
 * `view` is the cover rect at the region's aspect, so the wash fills the
 * visible area at any window shape rather than leaving borders down one side.
 */
export function buildMonstersIntMenuPreview(
  host: EngineHost,
  view: Rect,
  region: Rect,
): MenuPreview {
  const root = new Node2D('monsters-int-menu-preview-root')
  const node = new MenuPreviewNode(view, region)
  root.add(node)
  host.engine.tree.root.add(root)

  void Promise.all([loadCardImages(), loadMenuFace()])
    .then(([images, face]) => {
      if (!node.isDestroyed) node.setArt(images, face)
    })
    .catch((err: unknown) => {
      // A menu with no monster on it is a plain cream panel, which is a
      // cosmetic loss rather than a reason to have no menu.
      console.warn('[monsters-int] menu artwork failed to load', err)
    })

  // Held at zero so the fade has something to animate from, and so a rebuild on
  // resize does not flash.
  root.transform.alpha = 0
  root.play(
    { alpha: 1 },
    { duration: 0.4, easing: easings.outCubic, key: 'preview-in' },
  )
  return {
    destroy: () => {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
