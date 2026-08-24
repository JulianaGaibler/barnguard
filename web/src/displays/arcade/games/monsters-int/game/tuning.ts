/**
 * Every tunable constant for Monsters, Int: the palette, the table and button
 * geometry read off the reference art, the per-seat identity, and the timings.
 *
 * @remarks
 *   Geometry is given in the arcade's 1920x1080 layout space, the same space the
 *   art is drawn in, and converted to metres through `project.ts`. Keeping the
 *   numbers in the units they were measured in is what makes them checkable
 *   against the artwork.
 */
import { parseColor } from '@src/stargazer'
import { REGION_HEIGHT } from '../../../world'

/**
 * The art palette.
 *
 * Hex only. The canvas color parser accepts hex and `rgb()`/`rgba()` and
 * silently paints anything else black, so no `color-mix()` here.
 */
export const COLORS = {
  /** Near-black, the monster's mouth and every card ground. */
  ink: '#190607',
  inkShade: '#281011',
  /** The table. */
  cream: '#FFF9D9',
  /** The monster's skin, framing the table. */
  skin: '#FC4041',
  tongue: '#FF88A8',
  tongueShade: '#EE6F91',
  buttonCap: '#FFFFFF',
  buttonBody: '#EBEBEB',
  buttonSide: '#D8D8D8',
  buttonShade: '#B9B9B9',

  /**
   * The accent each card face is drawn in, so a card coming apart throws its
   * own colour and the burst names the card that caused it.
   *
   * Read off the artwork in `assets/cards`. `extraLife` carries the same hex as
   * `skin` for an unrelated reason, which is why it is named separately.
   */
  freeze: '#408FFC',
  threeMore: '#D14CB8',
  /**
   * What the monster brings a card up in. The Freeze card's blue on purpose:
   * the table is cream and red, so the one cool note in the palette is what
   * separates the deal from everything else painted on the same surface.
   */
  spit: '#408FFC',
  extraLife: '#FC4041',
  bonus: '#F88617',
  times2: '#FF5D98',
} as const

/**
 * A linear RGBA factor for a 3D material, from an sRGB hex string.
 *
 * The PBR program lights in linear space and sRGB-encodes on output, so a hex
 * value handed over raw comes out washed. Both surfaces still read the same
 * constant, which is the point.
 */
export function material(
  hex: string,
  alpha = 1,
  shade = 1,
): [number, number, number, number] {
  const c = parseColor(hex)
  // Shaded before the conversion, so the step reads the way it would if the
  // hex itself had been darkened. Scaling the linear value instead barely
  // shows on a light surface, which is most of this palette.
  return [
    toLinear(c.r * shade),
    toLinear(c.g * shade),
    toLinear(c.b * shade),
    alpha,
  ]
}

function toLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/**
 * The table, which is the whole visible ground.
 *
 * The art frames the cream with a band of the monster's skin, but a band behind
 * a flat surface only reads as a horizon under a camera that has one, and this
 * one is orthographic. So the ground is a single unbroken surface and the skin
 * survives only as the game's launcher color.
 *
 * The centre is the layout centre of the region, which is also the world
 * origin, and it is what the readouts over the table are placed against.
 */
export const TABLE = {
  centerX: 960,
  centerY: 545,
  /**
   * Metres across. Oversized rather than fitted: the camera slides a full
   * region height during the launcher pan, and an edge coming into frame there
   * would read as the table falling away.
   */
  size: 12,
} as const

/**
 * The two buttons, measured from the three stacked ellipses in the art.
 *
 * Two straight cylinders rather than one tapered one: a wide thin plate resting
 * on the table, and a narrower taller button standing on it. A single cone
 * reads as a funnel from this angle, where the stacked pair reads as a physical
 * arcade button with a lip.
 *
 * The total rise is derived rather than drawn. The cap centre sits 46.5px above
 * the base centre on screen, and a vertical offset projects to `h *
 * cos(ELEVATION)`. `project.test.ts` pins that derivation.
 */
export const BUTTONS = {
  leftX: 806,
  rightX: 1113,
  /**
   * Below the art's own 779.5, which pushes the whole bottom furniture down and
   * hands the space back to the cards. The lettering and the mouth move with
   * it, so the stack stays in the order the art draws it.
   */
  groundY: 800,
  /** The plate on the table. */
  baseRadius: 138,
  /** The button standing on the plate. */
  radius: 120,
  /** The dark eye on top. */
  holeRadius: 63,
  /** Share of the total rise taken by the plate, leaving the rest to the button. */
  baseHeightFrac: 0.26,
  /** Sides on each extrusion, enough to read as a smooth cylinder. */
  sides: 48,
  /**
   * How far the button sinks when pressed, in layout px. Around half the
   * button's own height, so the press is unmistakable on a screen people are
   * standing over rather than leaning into.
   */
  pressDepth: 20,
  /**
   * Where the lettering sits, from the art: outboard of each button rather than
   * under it. The mouth comes up close under the buttons, and a word centred
   * below one lands on the teeth.
   */
  labelLeftX: 658,
  labelRightX: 1291,
  labelY: 892,
  /**
   * Cap height of the lettering in layout px. Height rather than width, so HIT
   * and STAY are lettered at one size and the shorter word is simply shorter.
   */
  labelHeight: 40,
  /**
   * How far the cap centre sits above the base centre ON SCREEN, from the art's
   * three stacked ellipses. The height in world units follows from it, so the
   * buttons can be moved without the proportions coming apart.
   */
  capRiseOnScreen: 46.5,
  /**
   * How far a button rests INTO its plate while it takes no taps.
   *
   * Held down rather than dimmed alone. A control people are standing over has
   * to be readable at a glance from a metre away, and a shape that has changed
   * carries further than a color that has darkened.
   */
  restDepth: 13,
  /** How much of its color a disabled button keeps. */
  shade: 0.82,
  /** Thickness of the closed eye, as a share of the open one's radius. */
  lidThickness: 0.26,
} as const

/**
 * How often the buttons blink, in seconds.
 *
 * A blink only shuts the eye. It leaves the button standing and its colors up,
 * which is what keeps it from reading as the button going dead: a state says
 * three things at once, a blink says one and takes a moment.
 */
export const BLINK = {
  shut: 0.2,
  /** Eye open between the two halves of a double blink. */
  between: 0.12,
  minGap: 4,
  maxGap: 8,
} as const

/** The mouth, which the deck is dealt from. Centre and radii from the art. */
export const MOUTH = {
  centerX: 959.5,
  /**
   * Just under the buttons, with its lower half behind the lip. The teeth are
   * the part that has to read, and they hang from the top of it.
   */
  centerY: 1020,
  radiusX: 323.5,
  radiusY: 126,
} as const

/**
 * The active player's hand, lifted so they can read it.
 *
 * A card lying flat loses over half its height at this camera angle, which is
 * fine for a hand you are only counting and wrong for the one you are deciding
 * on. The whole hand tilts up and spreads while its owner is up.
 */
export const FOCUS = {
  /** How far the hand tilts toward the camera, in degrees. */
  tiltDeg: 62,
  /**
   * How much it shrinks.
   *
   * Smaller, not bigger. The focused hand moves to the top of the frame where
   * every player can see it, and at full size a seven-card hand up there would
   * fill the screen and bury the table.
   */
  scale: 0.78,
  /**
   * Where the centre of the focused hand sits.
   *
   * Not free to move up on its own. At three and five seats there is a seat at
   * dead centre, and the pill riding above the lifted hand has to clear the
   * pill above that seat's own cards, so this can only rise as far as the seat
   * ring does.
   */
  centerX: 960,
  centerY: 290,
  /** Kept between a focused hand and the frame edge. */
  margin: 110,
  /**
   * How far the hand floats above the table, in layout px.
   *
   * Under an orthographic camera a lift and a matching pull back along the
   * table cancel out, so this moves the hand a long way toward the viewer
   * without moving or growing it on screen. Distance is what the fog reads and
   * what the depth test sorts on, so this is what keeps the hand being decided
   * on clear of the haze and in front of every other hand.
   *
   * It has to clear the NEAREST seat, not the average one. Players sit down the
   * sides as well as across the back, and a seat by the buttons is a long way
   * toward the camera already.
   */
  hover: 420,
} as const

/** How far an out-of-play hand is washed toward the table. */
export const DIM = 0.55

/** A card, at the size the art draws one. */
export const CARD = {
  width: 128,
  height: 194,
  /** The art rounds a 128-wide card at `rx="12"`. */
  radius: 12,
  /**
   * Step between cards when a hand has all the room it wants: the card plus a
   * gap, so nothing overlaps and every value is readable at a glance.
   */
  unfoldedStep: 140,
  /** The tightest a crowded hand packs before it stops being countable. */
  minStep: 30,
  /** Fallback step, for a caller with no space budget to hand in. */
  fanStep: 44,
  /** Step between cards revealed together, which sit side by side. */
  revealStep: 150,
  /** Vertical stagger per card, so a flat fan depth-sorts without z-fighting. */
  lift: 0.3,
  /**
   * How far a card lying on the table may be turned off square, in degrees.
   *
   * Cards squared to the frame read as a diagram. A few degrees either way, the
   * same amount every time for the same card, reads as a hand somebody put
   * down.
   */
  spread: 4,
  /** Step between a seat's modifier cards, which draw small and side by side. */
  modifierStep: 66,
  /** How much smaller a modifier draws than a number card. */
  modifierScale: 0.46,
} as const

/** A seat's identity. */
export type SeatShape =
  'triangle' | 'square' | 'pentagon' | 'hexagon' | 'circle'

export interface SeatIdentity {
  shape: SeatShape
  color: string
  /** Sides for the marker extrusion. A circle is just a high side count. */
  sides: number
}

/**
 * Colour AND shape per seat, never color alone.
 *
 * Five accents happen to be exactly what the art palette carries. The shape is
 * what makes a seat identifiable for a player who cannot separate two of the
 * hues, and it doubles as the turn indicator, so it appears on the table
 * marker, the score chip and the result card from this one table.
 */
export const SEATS: readonly SeatIdentity[] = [
  { shape: 'triangle', color: '#FC4041', sides: 3 },
  { shape: 'square', color: '#5AC7B8', sides: 4 },
  { shape: 'pentagon', color: '#D14CB8', sides: 5 },
  { shape: 'hexagon', color: '#F88617', sides: 6 },
  { shape: 'circle', color: '#FF5D98', sides: 40 },
] as const

/** A seat's name, which is its shape. Numbers would be a second name for it. */
export function seatName(seat: number): string {
  const shape = SEATS[seat % SEATS.length]!.shape
  return shape.charAt(0).toUpperCase() + shape.slice(1)
}

/**
 * The band across the bottom of the frame: the monster's lower lip, its tongue,
 * and the two readouts painted on it.
 *
 * Every number is measured off `layout-bottom.png`. The lip artwork is authored
 * 156px tall against the foot of the 1920 by 1080 frame, so `top` is what pins
 * the two together and everything else hangs off the frame edges.
 */
export const BANNER = {
  /** Tall enough to cover the foot of the frame, and the art is drawn for it. */
  height: 156,
  top: REGION_HEIGHT - 156,
  /**
   * How far the art is drawn past the frame on three sides.
   *
   * The path is authored flush to the edges, and the bottom of it stops a third
   * of a pixel short, so at 1:1 the antialiased border leaves a hairline of
   * table showing. Bleeding it costs nothing offscreen.
   */
  bleed: 2,
  /**
   * Height of the lip path in its own coordinates, which its bottom stops short
   * of.
   */
  artHeight: 155.707,
  /** Kept between the frame edge and either readout. */
  margin: 36,
  /**
   * Where the tongue's top-left corner lands. Its 373px width centres it on the
   * mouth, which is what makes it read as coming out of the hole rather than as
   * a shape parked over one.
   */
  tongueX: 773,
  tongueY: 949,
  /** Left: the round, then a total per seat. */
  roundY: 1000,
  totalsY: 1026,
  totalHeight: 29,
  /** Right: whose turn it is, and a quieter line saying what that means. */
  statusY: 1001,
  noteY: 1036,
  /** Diameter of a seat's shape in the totals row and the status line. */
  glyph: 22,
} as const

/**
 * The column down the middle of the table that belongs to nobody.
 *
 * The card being drawn stands here and the hand being decided on is held up
 * here, both of them over everyone else's cards. Half-width in layout px from
 * the centre line, and roughly the width of the two buttons, so the whole
 * middle of the frame reads as one stage from the top edge down to the mouth.
 *
 * Seats are placed around it rather than on it, which is what makes the odd
 * player counts asymmetric: a symmetric arc puts one seat at top dead centre.
 */
export const CLEAR_COLUMN = 270

/**
 * The ring the seats stand on, in layout space.
 *
 * Sized against the VISIBLE region rather than the table. The table runs off
 * both edges of the frame on purpose, so a seat ring expressed as a fraction of
 * it puts the outermost players off screen at every player count.
 *
 * The width leaves room for a five-card fan plus a margin inside 1920. The
 * height keeps the whole run above the buttons and below the top edge.
 */
export const SEAT_RING = {
  centerX: 960,
  /**
   * High on the frame, which is what the readouts moving into the bottom
   * corners paid for. It buys clearance in both directions at once: the far
   * seats gain room above for the hand being decided on, and the near seats
   * pull away from the buttons.
   */
  centerY: 520,
  radiusX: 780,
  /**
   * Not free to shrink. Two seats whose fans overlap horizontally have to be
   * far enough apart in depth that neither covers the other, and at five seats
   * a card height of separation is exactly what this buys.
   */
  radiusY: 330,
} as const

/** Seconds. Engine time, so a paused game holds. */
export const ANIM = {
  /**
   * A card travelling, wherever it is going.
   *
   * One duration for every move a card makes. Out of the mouth, up to the
   * reveal, home to a hand, up into a focused one: they are all the same
   * gesture, and two of them running at different speeds at the same moment
   * reads as one of the cards being wrong rather than as variety.
   */
  move: 0.55,
  /** The button press dip, each way. */
  buttonPress: 0.09,
  /**
   * A finished card shrinking into the pieces it comes apart as.
   *
   * Short enough to read as breaking rather than as travelling, long enough
   * that the card is still there for the frames the burst spends expanding. Cut
   * it instead and the card is gone before there is anything to replace it.
   */
  collapse: 0.12,
  /**
   * A hand washing out once its owner is out of the round.
   *
   * Faded rather than switched. A hand that greys between two frames reads as a
   * draw bug, where a hand that drains reads as something that just happened to
   * it.
   */
  dimFade: 0.3,
  /**
   * An Extra Life going for the duplicate that would have busted its owner,
   * before the two of them come apart together.
   *
   * Without this beat both cards simply stop existing next to each other, and
   * nothing about that says one ate the other.
   */
  saveLunge: 0.25,
  /**
   * Between one card in a hand starting to move and the next.
   *
   * A hand that re-places every card at once reads as a diagram redrawing
   * itself. A short cascade reads as someone tidying them.
   */
  stagger: 0.045,
} as const

/**
 * The turn each card of a finished row takes, and the gap between them.
 *
 * Long and loose next to `ANIM.stagger`, which exists to stop a hand reading as
 * a diagram redrawing itself. This is the opposite job: the row is finished and
 * the wave down it is the point, so each card wants to be watched separately.
 */
export const SEVEN = {
  spin: 0.5,
  stagger: 0.09,
} as const

/**
 * How long the table holds on each thing the rules report, in seconds.
 *
 * This is the entire pacing surface of the game. The rules layer knows nothing
 * about time, so everything about how a round FEELS is here, and a `fakeClock`
 * test can pin the sequence without a canvas.
 */
export const PACE: Record<string, number> = {
  /** The reveal is the beat that matters: this is a player reading their card. */
  dealt: 1.5,
  /**
   * The opening deal, which is one card per seat with nothing to decide. Held
   * long enough to see what it is on the way past, and no longer: five of these
   * back to back at the reading pace above is most of a minute before anyone
   * plays.
   */
  dealing: 0.65,
  /**
   * What follows is mostly SHOWN, not read. A bust spins the card and greys the
   * hand, a stay leaves it lying there, a freeze banks somebody. The line on
   * the lip says which for anyone who missed it, but nobody should be waiting
   * on the sentence, so these are held for the animation and not for the
   * words.
   *
   * The seven is the exception: it ends the round out of nowhere and the table
   * needs a moment to see why.
   */
  duplicate: 0.6,
  lifeSpent: 1.2,
  busted: 0.9,
  /**
   * Long, and now mostly spent on the celebration rather than on the sentence:
   * the row has to finish arriving before it can turn, and the turn is a wave
   * down seven cards.
   */
  seven: 2.6,
  stayed: 0.5,
  frozen: 1,
  threeMoreStarted: 1,
  lifeTaken: 0.7,
  lifeGiven: 0.9,
  lifeDiscarded: 0.7,
  reshuffled: 1,
  turnChanged: 0.45,
  roundOver: 0.4,
  /**
   * After the last card, before the summary opens.
   *
   * Short. The summary is the announcement, and it says the same thing with the
   * numbers attached, so holding an empty table first is dead time.
   */
  roundSettle: 0.5,
  /**
   * After a card that has to be aimed, before the picker opens over it.
   *
   * The card's own hold starts as it leaves the mouth, so a third of it is
   * spent watching the card fly. This is the part where it is standing still
   * and can actually be read, which is the whole reason it stops there.
   */
  beforeTarget: 0.8,
}

/**
 * Distance haze, raised while the table is showing something and lowered again
 * once every card is at rest.
 *
 * The color is the table's own, so what the haze actually does is fade the far
 * seats' cards into the surface while the hand being decided on, and the card
 * being drawn, stay clear. Both of those float well above the table (see
 * `FOCUS.hover`), which is what puts them nearer the camera than the seats they
 * are drawn over.
 *
 * Linear rather than exponential, since the table is a known depth and the
 * falloff has to start past the near seats rather than at the camera.
 */
export const FOG = {
  color: [1, 0.976, 0.851] as [number, number, number],
  /** Metres from the camera at which the haze begins, at full strength. */
  start: 1.55,
  /** Where it reaches full strength. */
  end: 2.9,
  /**
   * Where the ramp parks when the haze is down. Past the far edge of the
   * visible table, so the whole scene sits in front of it.
   *
   * Sliding the ramp out is what fades the fog. The renderer has no strength
   * dial, and moving `end` alone would flatten the falloff on the way instead
   * of lifting it evenly.
   */
  clear: 6,
  /** Seconds for the haze to come up or go down. */
  fade: 0.5,
  /**
   * Haze level for the beat a round is won on, on the same scale `raised` uses
   * and deliberately past its 1.
   *
   * Pulling the ramp nearer than anything else asks for turns the distance haze
   * that already exists into a spotlight, with no second render pass. The
   * winning row is what it spares, and only just: at this level the row sits
   * under half a percent of haze while the far arc reaches four fifths.
   *
   * It cannot dim a seat near the buttons, and no level can. Those seats are
   * 1.13m from the camera against the lifted row's 1.29m, so any ramp that
   * leaves the row clear leaves them clear too. At two and three players
   * everyone sits on the far arc and the spotlight is total.
   */
  spotlight: 1.06,
} as const

/** Every burst the table can throw. */
export type BurstName =
  | 'spit'
  | 'bust'
  | 'save'
  | 'dissolve'
  | 'shatter'
  | 'float'
  | 'seven'
  | 'sevenFlecks'

/**
 * How one burst moves, in layout px and seconds. Shapes and colours are not
 * here: those follow the seat or the card, and `flourish.ts` supplies them.
 */
export interface BurstFeel {
  count: number
  /**
   * Cone axis in radians, or undefined to scatter in every direction. Screen y
   * grows downward, so `-PI / 2` is straight up.
   */
  axis?: number
  /** Cone half-angle. Ignored by a scatter. */
  spread: number
  /**
   * How wide a strip the pieces launch from, rather than all from one point.
   *
   * For a burst that belongs to something with a size of its own. The mouth is
   * over 400px across at the lip, and a puff from its centre point reads as a
   * pinprick under it. Omit for a burst that has a single place it came from.
   */
  spawnWidth?: number
  speed: readonly [number, number]
  /**
   * Across, for a disc the diameter. Against a card, which is 128 wide, so a
   * piece has to be tens of pixels to read at all on a screen played standing
   * up.
   */
  size: readonly [number, number]
  /**
   * Sized against the fall rather than picked. Each of these is about what it
   * takes a piece to arc and reach the foot of the frame under its own gravity,
   * so a burst finishes as it leaves the screen instead of spending a third of
   * its life below it.
   */
  life: readonly [number, number]
  /**
   * Downward, so a negative value floats.
   *
   * Weight is carried by this and by `damp` together: a piece reads as light
   * while drag is holding it up, however hard it is being pulled down, so heft
   * means high gravity AND low drag rather than either one alone.
   */
  gravity: number
  /** Exponential drag per second. */
  damp: number
  /** Peak sideways drift, which is what makes a piece read as drifting. */
  flutter: number
}

/**
 * What each moment on the table throws.
 *
 * The one that fires constantly, `spit`, is deliberately the palest. Every card
 * in the game comes out of the mouth, so anything dark enough to notice
 * individually reads as the table getting dirty by the end of a round. It is
 * also the only beat placed anywhere but on the card it belongs to: a card
 * arriving is the monster coughing it up, and the hole is where that reads.
 *
 * `shatter` and `float` are the same event, an aimed card arriving, told apart
 * on purpose: one is a punishment and one is a gift, and they should not look
 * alike. That is also the reason gravity and drag are per burst rather than per
 * emitter (see `ConfettiNode`).
 */
export const FLOURISH: Record<BurstName, BurstFeel> = {
  /**
   * The monster bringing a card up. Wide and short-lived, so it billows out of
   * the hole and settles rather than shooting up the frame.
   */
  spit: {
    count: 12,
    axis: -Math.PI / 2,
    // Tighter than it looks, because the launch is fast: at this speed a wide
    // cone throws pieces most of the way across the foot of the frame.
    spread: 0.85,
    // The mouth's own opening where it meets the lip, less a margin, so the
    // pieces come up out of the hole rather than off its corners.
    spawnWidth: 380,
    // Enough to clear the lip and arc, since the lip covers the bottom of the
    // frame and anything slower is over before it is out of the hole.
    speed: [380, 780],
    size: [8, 18],
    life: [1, 1.6],
    gravity: 1100,
    damp: 0.7,
    flutter: 0,
  },
  /** The duplicate that ends a hand, breaking where it lies. */
  bust: {
    count: 16,
    spread: 0,
    speed: [140, 340],
    size: [9, 20],
    life: [0.85, 1.4],
    gravity: 1600,
    damp: 0.7,
    flutter: 0,
  },
  /** An Extra Life eating a duplicate. The one cheerful thing a bust can do. */
  save: {
    count: 20,
    spread: 0,
    speed: [200, 460],
    size: [9, 20],
    life: [1.1, 1.8],
    gravity: 1200,
    damp: 0.9,
    flutter: 0,
  },
  /** Any card the round has finished with. */
  dissolve: {
    count: 14,
    spread: 0,
    speed: [120, 300],
    size: [9, 22],
    life: [1, 1.6],
    gravity: 1300,
    damp: 0.9,
    flutter: 0,
  },
  /** A Freeze landing on the seat it was aimed at. Fast, heavy, over quickly. */
  shatter: {
    count: 22,
    spread: 0,
    speed: [280, 560],
    size: [7, 17],
    life: [0.85, 1.35],
    gravity: 2200,
    damp: 0.6,
    flutter: 0,
  },
  /** A Three More landing. Slow and weightless, where the Freeze is neither. */
  float: {
    count: 18,
    spread: 0,
    speed: [50, 130],
    size: [11, 24],
    life: [1.6, 2.4],
    gravity: -20,
    damp: 1.8,
    flutter: 30,
  },
  /** The winner's own shape, thrown off each card of the finished row. */
  seven: {
    count: 12,
    spread: 0,
    speed: [260, 560],
    size: [18, 34],
    life: [1.3, 2.1],
    gravity: 1300,
    damp: 0.8,
    flutter: 55,
  },
  /** Thrown with it, to keep a row of one shape in one colour from flattening. */
  sevenFlecks: {
    count: 8,
    spread: 0,
    speed: [220, 460],
    size: [7, 14],
    life: [1.15, 1.85],
    gravity: 1500,
    damp: 0.9,
    flutter: 40,
  },
}
