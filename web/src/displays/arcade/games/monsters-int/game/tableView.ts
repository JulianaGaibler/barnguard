/**
 * Turns what the rules report into what the table shows.
 *
 * @remarks
 *   Cards come from a pool and are never destroyed mid-match, so their GPU
 *   buffers upload once and a card keeps its identity as it moves.
 *
 *   Every change re-places the WHOLE table in one pass, and `CardNode` ignores a
 *   pose it is already holding. That pairing is what makes the layout a
 *   function of the round rather than a list of moves: no card can be left
 *   stranded because nobody thought to move it, and nothing that did not change
 *   animates.
 * @example
 *   const view = createTableView(root, textures, 4)
 *   view.beginRound(round)
 *   view.apply({ type: 'dealt', seat: 1, card }, round)
 */
import { ignoreAbort, Node3D } from '@src/stargazer'
import type { CardTextures } from './art/cardTextures'
import { CARD_BACK } from './art/cardTextures'
import {
  deliveryPose,
  fanPose,
  focusPose,
  modifierPose,
  mouthPose,
  revealPose,
  REVEAL_SCALE,
  spitPoint,
} from './cardLayout'
import { cardColor, type Flourish, type FlourishKind } from './flourish'
import { layoutFromWorld } from './project'
import { CardNode } from './nodes/CardNode'
import { faceOf, type DeckCard } from './rules/cards'
import { playerCards, type PlayerState } from './rules/player'
import type { RoundEvent, RoundState } from './rules/round'
import {
  seatPlacements,
  seatSpace,
  type SeatCount,
  type SeatPlacement,
} from './seats'
import { ANIM, SEVEN } from './tuning'

export interface TableView {
  apply(event: RoundEvent, round: RoundState): void
  beginRound(round: RoundState): void
  /** Lift one seat's hand to be read, and settle every other one. */
  setActiveSeat(seat: number | null, round: RoundState | null): void
  clearRound(): void
  destroy(): void
}

export interface TableViewOptions {
  /**
   * Called when the table starts or stops holding something up: a card at the
   * reveal, or a hand being decided on. The haze follows it.
   */
  onForeground?: (active: boolean) => void
  /**
   * Called when a hand is lifted to be decided on, or set back down. The seat's
   * readout follows its cards, so this is the one place that decides where both
   * of them are.
   */
  onFocus?: (seat: number | null) => void
  /**
   * Called when a moment is worth throwing particles at. The table knows what
   * happened and where it happened, and nothing about how either is drawn.
   */
  onFlourish?: (f: Flourish) => void
  /**
   * Called for the beat a round is won on, so the haze can close in around the
   * finished row. Lowered again the moment the row goes home.
   */
  onSpotlight?: (on: boolean) => void
}

/**
 * Events after which the seat that was up is no longer deciding.
 *
 * Dropping the focus here rather than waiting for the next turn prompt is what
 * sends the card just drawn and the hand it joins home in one motion, instead
 * of the card flying up into the hand and the whole hand then coming down.
 */
const ENDS_TURN = new Set<RoundEvent['type']>([
  'stayed',
  'busted',
  'frozen',
  'threeMoreStarted',
])

export function createTableView(
  parent: Node3D,
  textures: CardTextures,
  seats: SeatCount,
  opts: TableViewOptions = {},
): TableView {
  const layer = new Node3D('monsters-int-cards')
  parent.add(layer)
  const placements = seatPlacements(seats)

  /** A card on the table, and the node showing it. */
  interface Held {
    node: CardNode
    card: DeckCard
  }

  /** Pooled nodes, keyed by the physical card currently using one. */
  const pool: CardNode[] = []
  const inUse = new Map<string, Held>()
  /**
   * Nodes part way through coming apart, which belong to neither `inUse` nor
   * the pool until they finish. A reset has to account for them or a node still
   * shrinking would reach the pool after the next round had already taken it.
   */
  const collapsing = new Set<CardNode>()
  /**
   * Cards the round stopped accounting for on the pass before this one.
   *
   * The rules mutate a whole batch before the table is shown the first event of
   * it, so a card is already in a spent pile while the deal that spent it is
   * still being played out. Sweeping on the second pass that misses a card
   * gives the event which explains its departure time to arrive and break the
   * card itself, at the moment that reads.
   */
  const doomed = new Set<string>()
  /**
   * Cards on their way to the seat they were aimed at.
   *
   * The round accounts for an aimed card nowhere the moment it is played, so
   * without this the sweep would take it off the table before it had gone
   * anywhere. It leaves under its own event instead, once it arrives.
   */
  const departing = new Set<string>()
  let created = 0

  function take(card: DeckCard): CardNode {
    const existing = inUse.get(card.id)
    if (existing) return existing.node
    const node = pool.pop() ?? newCard()
    node.visible = true
    node.setDimmed(false)
    node.setFace(
      textures[faceOf(card.card)] ?? textures[CARD_BACK]!,
      textures[CARD_BACK]!,
    )
    inUse.set(card.id, { node, card })
    return node
  }

  function newCard(): CardNode {
    const node = new CardNode(`monsters-int-card-${created++}`)
    layer.add(node)
    return node
  }

  function release(node: CardNode): void {
    node.park()
    pool.push(node)
  }

  function flourish(f: Flourish): void {
    opts.onFlourish?.(f)
  }

  /**
   * Take a finished card off the table by breaking it, rather than by no longer
   * drawing it.
   *
   * The node reaches the pool only once the collapse is over, and only if a
   * reset has not already claimed it in the meantime.
   */
  /** Break a card the table is done with, wherever it currently is. */
  function retireCard(card: DeckCard, kind: FlourishKind = 'dissolve'): void {
    const held = inUse.get(card.id)
    if (!held) return
    inUse.delete(card.id)
    doomed.delete(card.id)
    departing.delete(card.id)
    retire(held, kind)
  }

  function retire(held: Held, kind: FlourishKind = 'dissolve'): void {
    const { node } = held
    flourish({
      kind,
      at: layoutFromWorld(node.transform.position),
      color: cardColor(held.card),
    })
    if (!node.engine) {
      release(node)
      return
    }
    collapsing.add(node)
    void node
      .collapse()
      .then(() => {
        if (collapsing.delete(node) && !node.isDestroyed) release(node)
      })
      .catch(ignoreAbort)
  }

  /**
   * Run something after a beat, unless the table is reset in the meantime.
   *
   * A delayed beat outliving its round would settle a round that is over or
   * throw particles at cards that have already been swept, so every one of them
   * carries the generation it was scheduled in. With no engine there is no
   * clock to wait on and everything happens at once, which is what a test
   * wants.
   */
  function later(seconds: number, run: () => void): void {
    if (!layer.engine) {
      run()
      return
    }
    const era = generation
    void layer
      .wait(seconds)
      .then(() => {
        if (era === generation) run()
      })
      .catch(ignoreAbort)
  }

  /**
   * Carry an aimed card to the seat it was played at, and break it there.
   *
   * A Freeze or a Three More is chosen and then accounted for nowhere, so it
   * used to stop existing at the reveal and the table never showed who it hit.
   * The two land differently on purpose: one is a punishment and one is a
   * gift.
   */
  function deliver(
    cards: readonly DeckCard[],
    seat: number,
    kind: FlourishKind,
  ): void {
    const place = placements[seat]
    for (const card of cards) {
      const held = inUse.get(card.id)
      if (!held) continue
      if (!place) {
        retireCard(card, kind)
        continue
      }
      departing.add(card.id)
      held.node.moveTo(deliveryPose(place))
      later(ANIM.move, () => retireCard(card, kind))
    }
  }

  /**
   * An Extra Life eating the duplicate that would have busted its owner.
   *
   * The life goes for the card before the two of them leave together. Both are
   * bound for the spent pile, so settling straight away would have them stop
   * existing side by side, which says nothing about one having saved the
   * other.
   */
  function showSave(
    life: DeckCard,
    duplicate: DeckCard,
    round: RoundState,
  ): void {
    const eater = inUse.get(life.id)
    const target = inUse.get(duplicate.id)
    if (!eater || !target) {
      settle(round)
      return
    }
    const p = target.node.transform.position
    const onto = { x: p.x, y: p.y, z: p.z }
    eater.node.moveTo(
      { ...onto, facing: 'upright', scale: REVEAL_SCALE },
      ANIM.saveLunge,
    )
    later(ANIM.saveLunge, () => {
      flourish({ kind: 'save', at: layoutFromWorld(onto) })
      retireCard(life)
      retireCard(duplicate)
      settle(round)
    })
  }

  /** Whose hand is currently lifted, so a re-layout keeps it lifted. */
  let focused: number | null = null
  /**
   * Cards held up at the reveal, in the order they arrived.
   *
   * All for one seat. A Three More deals three in a row with nothing in
   * between, and those belong side by side, but the opening deal is also
   * nothing but deals and those belong one at a time in front of five different
   * people.
   *
   * A Freeze or a Three More waiting to be aimed lives here too, because it
   * belongs to nobody yet and the reveal is the only place it has.
   */
  let standing: DeckCard[] = []
  /** Who the standing cards are for, so a deal to anyone else lands them first. */
  let standingSeat: number | null = null
  let foreground = false
  /** Bumped on every reset, so a delayed beat can tell it has been left behind. */
  let generation = 0
  /** Whether the haze is closed in around a finished row. */
  let spotlight = false
  /**
   * The card that just came up a second time. The bust that follows it is a
   * separate event carrying no card, and a duplicate is also what an Extra Life
   * eats, so which of the two happens is not known when it lands.
   */
  let duplicate: DeckCard | null = null

  /**
   * The kept cards: modifiers, plus a held Extra Life, which is a card in front
   * of the player like any other and has to be given a place.
   */
  function keptCards(player: PlayerState): DeckCard[] {
    const kept = [...player.modifiers]
    if (player.life) kept.push(player.life)
    return kept
  }

  /**
   * Every card the round still has in front of a player.
   *
   * Not `playerCards`, which counts the spent pile too. A card the rules have
   * set aside is finished, and finished is exactly what makes it leave.
   */
  function onTable(player: PlayerState): DeckCard[] {
    return [...player.numbers, ...keptCards(player)]
  }

  /**
   * Cards in a hand, low to high.
   *
   * Sorted for display only. The rules keep them in the order they arrived,
   * which is what a replay and the duplicate check read, so this sorts a copy.
   */
  function inOrder(cards: readonly DeckCard[]): DeckCard[] {
    return [...cards].sort((a, b) => {
      const av = a.card.kind === 'number' ? a.card.value : -1
      const bv = b.card.kind === 'number' ? b.card.value : -1
      return av - bv
    })
  }

  /**
   * Re-place every card on the table in one pass.
   *
   * Seats first, then whatever is still held up over the top of them, then a
   * release for everything the round no longer accounts for. Doing all three
   * together is the guarantee: a card the rules have set aside goes away, and a
   * card belonging to nobody yet keeps a place instead of hanging wherever it
   * was last put.
   */
  function layoutAll(round: RoundState): void {
    const held = new Set(standing.map((c) => c.id))
    const seen = new Set<string>(held)

    for (const player of round.players) {
      const seat = placements[player.seat]
      if (!seat) continue
      for (const card of onTable(player)) seen.add(card.id)

      // A card still being shown is counted out of its own hand. The rules put
      // it there the moment it was dealt, but the hand should not open a gap
      // for it until it actually arrives.
      const hand = inOrder(player.numbers).filter((c) => !held.has(c.id))
      const kept = keptCards(player).filter((c) => !held.has(c.id))

      if (focused === player.seat) {
        // Numbers and bonuses ride up together and come back down together.
        // Leaving the bonuses on the table would send them home ahead of the
        // hand they belong to, in a motion of their own.
        const all = [...hand, ...kept]
        all.forEach((card, i) => {
          take(card).moveTo(
            focusPose(i, all.length),
            ANIM.move,
            i * ANIM.stagger,
          )
        })
        continue
      }

      const space = seatSpace(seats, player.seat)
      hand.forEach((card, i) => {
        take(card).moveTo(
          fanPose(seat, i, hand.length, space),
          ANIM.move,
          i * ANIM.stagger,
        )
      })
      // Cascading from its own left edge, alongside the numbers rather than
      // behind them. Queueing the bonuses after the hand made them read as a
      // separate, later motion.
      kept.forEach((card, i) => {
        take(card).moveTo(
          modifierPose(seat, i, kept.length),
          ANIM.move,
          i * ANIM.stagger,
        )
      })
    }

    standing.forEach((card, i) => {
      take(card).moveTo(revealPose(i, standing.length), ANIM.move)
    })

    // A card the round accounts for nowhere is finished. Held one pass before
    // it goes, since the event that says why is always the next one along.
    for (const [id, held] of [...inUse]) {
      if (seen.has(id) || departing.has(id)) {
        doomed.delete(id)
        continue
      }
      if (!doomed.has(id)) {
        doomed.add(id)
        continue
      }
      doomed.delete(id)
      inUse.delete(id)
      retire(held)
    }

    setForeground(standing.length > 0 || focused !== null)
  }

  function setForeground(active: boolean): void {
    if (foreground === active) return
    foreground = active
    opts.onForeground?.(active)
  }

  function setFocused(seat: number | null): void {
    if (seat === null) setSpotlight(false)
    if (focused === seat) return
    focused = seat
    opts.onFocus?.(seat)
  }

  function setSpotlight(on: boolean): void {
    if (spotlight === on) return
    spotlight = on
    opts.onSpotlight?.(on)
  }

  /**
   * The row that just completed a set of seven, turning card by card.
   *
   * The hand stays lifted instead of going home, which is why `seven` is not in
   * `ENDS_TURN`. It is the finished row and the only thing on the table worth
   * looking at, and it goes home a beat later when the round is scored.
   *
   * The seat is lifted rather than assumed to be up already, since a Three More
   * can complete somebody else's set while they are not the one playing.
   */
  function celebrateSeven(seat: number, round: RoundState): void {
    setFocused(seat)
    settle(round)
    const row = inOrder(round.players[seat]?.numbers ?? [])
    // The row is still arriving. Turning it on the way in would read as cards
    // tumbling into place rather than as a flourish on a finished hand.
    const arrived = ANIM.move + Math.max(0, row.length - 1) * ANIM.stagger
    later(arrived, () => {
      setSpotlight(true)
      row.forEach((card, i) => {
        const held = inUse.get(card.id)
        if (!held) return
        held.node.spin(1, SEVEN.spin, i * SEVEN.stagger)
        // Thrown at the middle of a card's own turn, so the shapes read as
        // flung off it rather than as a burst that happens to coincide.
        later(i * SEVEN.stagger + SEVEN.spin / 2, () => {
          flourish({
            kind: 'seven',
            at: layoutFromWorld(held.node.transform.position),
            seat,
          })
        })
      })
    })
  }

  /**
   * Send home whatever the round has found a home for, and re-place the rest.
   *
   * A card the round accounts for anywhere, even in a discard pile, is done
   * being shown. Only a card it accounts for nowhere stays up, which is exactly
   * an action waiting to be aimed.
   */
  function settle(round: RoundState): void {
    if (standing.length > 0) {
      const known = new Set<string>()
      for (const player of round.players) {
        for (const card of playerCards(player)) known.add(card.id)
      }
      standing = standing.filter((c) => !known.has(c.id))
      if (standing.length === 0) standingSeat = null
    }
    layoutAll(round)
  }

  function dimSeat(player: PlayerState, dimmed: boolean): void {
    for (const card of playerCards(player)) {
      inUse.get(card.id)?.node.setDimmed(dimmed)
    }
  }

  return {
    beginRound(round) {
      generation++
      duplicate = null
      doomed.clear()
      setSpotlight(false)
      layoutAll(round)
    },

    apply(event, round) {
      if (ENDS_TURN.has(event.type)) setFocused(null)

      switch (event.type) {
        case 'dealt':
          // The last seat's cards go home as this one's comes up, so the deal
          // reads as one card at a time rather than a row collecting in the
          // middle of the table.
          if (standingSeat !== null && standingSeat !== event.seat) {
            settle(round)
          }
          standingSeat = event.seat
          take(event.card).snapTo(mouthPose())
          standing.push(event.card)
          layoutAll(round)
          // From the hole rather than from the card: a card arriving is the
          // monster bringing it up, and nothing about that happens where the
          // card ends up.
          flourish({ kind: 'spit', at: spitPoint() })
          return
        case 'duplicate':
          duplicate = event.card
          inUse.get(event.card.id)?.node.spin(1)
          return
        case 'lifeSpent':
          duplicate = null
          showSave(event.life, event.duplicate, round)
          return
        case 'frozen':
        case 'threeMoreStarted': {
          // The aimed card is whatever is still held up belonging to nobody,
          // which is exactly what `standing` holds.
          const aimed = standing
          standing = []
          standingSeat = null
          deliver(
            aimed,
            event.seat,
            event.type === 'frozen' ? 'shatter' : 'float',
          )
          settle(round)
          return
        }
        case 'seven':
          celebrateSeven(event.seat, round)
          return
        case 'busted': {
          // Where the duplicate is standing, which is the reveal it was just
          // read at rather than the hand it is on its way to.
          const broke = duplicate && inUse.get(duplicate.id)
          if (broke) {
            flourish({
              kind: 'bust',
              at: layoutFromWorld(broke.node.transform.position),
            })
          }
          duplicate = null
          settle(round)
          dimSeat(round.players[event.seat]!, true)
          return
        }
        default:
          settle(round)
      }
    },

    setActiveSeat(seat, round) {
      setFocused(seat)
      if (round) settle(round)
    },

    clearRound() {
      generation++
      duplicate = null
      setFocused(null)
      setSpotlight(false)
      standing = []
      standingSeat = null
      for (const [, held] of inUse) release(held.node)
      inUse.clear()
      for (const node of collapsing) release(node)
      collapsing.clear()
      doomed.clear()
      departing.clear()
      setForeground(false)
    },

    destroy() {
      setForeground(false)
      setSpotlight(false)
      if (!layer.isDestroyed) layer.destroy()
    },
  }
}

/** Exposed for the scene handle, which owns the seat placements too. */
export type { SeatPlacement }
