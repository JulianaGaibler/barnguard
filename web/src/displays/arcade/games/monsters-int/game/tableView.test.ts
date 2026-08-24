import { describe, expect, it } from 'vitest'
import { Node3D } from '@src/stargazer'
import { createTableView, type TableView } from './tableView'
import { CardNode } from './nodes/CardNode'
import {
  applyInput,
  createRound,
  stepRound,
  type RoundState,
} from './rules/round'
import {
  fixedRandom,
  freeze,
  life,
  n,
  stackedDeck,
  threeMore,
} from './rules/scriptedDeck'
import type { Card } from './rules/cards'
import type { CardTextures } from './art/cardTextures'
import { REVEAL, spitPoint } from './cardLayout'
import { burstFor } from './flourish'
import { seatPlacements } from './seats'
import { FOCUS } from './tuning'
import type { Flourish } from './flourish'
import { BANNER, COLORS } from './tuning'
import { layoutFromWorld } from './project'

// The invariant this file exists for: every card the table is holding has a
// place, every pass. A card belonging to nobody yet, which is exactly a Freeze
// or a Three More waiting to be aimed, is the one the round accounts for
// nowhere, and it used to hang wherever it was last put while the rest of the
// table moved around it.

/** Any face will do. Nothing here touches a device. */
const textures = new Proxy({}, { get: () => ({}) }) as CardTextures

interface Table {
  root: Node3D
  view: TableView
  state: RoundState
}

/** A round dealing this stack, ready to be played. */
function seatedTable(seats: 2 | 3 | 4 | 5, cards: Card[]): Table {
  const root = new Node3D('root')
  const view = createTableView(root, textures, seats)
  const state = createRound(seats, stackedDeck(...cards))
  view.beginRound(state)
  return { root, view, state }
}

/** The common case: two seats. */
function table(...cards: Card[]): Table {
  return seatedTable(2, cards)
}

/** Advance the round until it wants an answer, showing everything on the way. */
function play({ view, state }: Table, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    if (state.pending.kind !== 'none' || state.ended) break
    for (const event of stepRound(state, fixedRandom)) view.apply(event, state)
  }
}

/** Answer the open prompt, showing what it caused. Does not play on. */
function answer(t: Table, input: Parameters<typeof applyInput>[1]): void {
  for (const event of applyInput(t.state, input)) t.view.apply(event, t.state)
}

/** Every card node currently on the table, wherever it sits. */
function shown(root: Node3D): CardNode[] {
  const out: CardNode[] = []
  const walk = (node: Node3D): void => {
    if (node instanceof CardNode && node.visible) out.push(node)
    for (const child of node.children) if (child instanceof Node3D) walk(child)
  }
  walk(root)
  return out
}

/** Whether a card is held up at the reveal rather than lying in a hand. */
const atReveal = (card: CardNode): boolean =>
  Math.abs(layoutFromWorld(card.transform.position).y - REVEAL.y) < 1

describe('createTableView', () => {
  it('keeps an action waiting to be aimed at the reveal', () => {
    // A number each, then the first seat hits into a Three More. Two seats are
    // active, so the card belongs to nobody until somebody aims it.
    const t = table(n(1), n(2), threeMore)
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    expect(t.state.pending.kind).toBe('target')
    expect(shown(t.root).filter(atReveal)).toHaveLength(1)
  })

  it('takes that action off the table the moment it is aimed', () => {
    const t = table(n(1), n(2), threeMore, n(3), n(4), n(5))
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    const action = shown(t.root).find(atReveal)!

    // Checked before the run continues: the pool hands a released node to the
    // very next card drawn.
    answer(t, { kind: 'target', seat: 1 })
    expect(action.visible).toBe(false)
  })

  it('shows exactly the cards the round says are in play', () => {
    const t = table(n(1), n(2), threeMore, n(3), n(4), n(5))
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    answer(t, { kind: 'target', seat: 1 })
    play(t)

    const inPlay = t.state.players.flatMap((p) => [
      ...p.numbers,
      ...p.modifiers,
    ]).length
    expect(shown(t.root)).toHaveLength(inPlay)
  })

  // The opening deal is nothing but deals, so grouping them by "consecutive"
  // collected the whole table's first cards in the middle of the frame.
  it('deals one card at a time, not a row of them', () => {
    const t = seatedTable(5, [n(1), n(2), n(3), n(4), n(5)])
    let most = 0
    for (let i = 0; i < 40; i++) {
      if (t.state.pending.kind !== 'none' || t.state.ended) break
      for (const event of stepRound(t.state, fixedRandom)) {
        t.view.apply(event, t.state)
        most = Math.max(most, shown(t.root).filter(atReveal).length)
      }
    }
    expect(most).toBe(1)
    expect(t.state.players.every((p) => p.numbers.length === 1)).toBe(true)
  })

  // A Three More is three cards to ONE seat, which is the case the grouping
  // exists for.
  it('shows a run of cards to one seat side by side', () => {
    const t = table(n(1), n(2), threeMore, n(3), n(4), n(5))
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    answer(t, { kind: 'target', seat: 1 })
    let most = 0
    for (let i = 0; i < 40; i++) {
      if (t.state.pending.kind !== 'none' || t.state.ended) break
      for (const event of stepRound(t.state, fixedRandom)) {
        t.view.apply(event, t.state)
        most = Math.max(most, shown(t.root).filter(atReveal).length)
      }
    }
    expect(most).toBe(3)
  })

  it('lets go of every card when the round is swept', () => {
    const t = table(n(1), n(2), n(3), n(4))
    play(t)
    expect(shown(t.root).length).toBeGreaterThan(0)
    t.view.clearRound()
    expect(shown(t.root)).toHaveLength(0)
  })

  it('reports the foreground so the haze can follow it', () => {
    const seen: boolean[] = []
    const root = new Node3D('root')
    const view = createTableView(root, textures, 2, {
      onForeground: (active) => seen.push(active),
    })
    const state = createRound(2, stackedDeck(n(1), n(2)))
    view.beginRound(state)
    for (const event of stepRound(state, fixedRandom)) view.apply(event, state)
    expect(seen).toContain(true)

    view.clearRound()
    expect(seen.at(-1)).toBe(false)
  })
})

/** A table that records every burst it asks for. */
function recordingTable(
  cards: Card[],
): Table & { thrown: Flourish[]; spot: boolean[] } {
  const thrown: Flourish[] = []
  const spot: boolean[] = []
  const root = new Node3D('root')
  const view = createTableView(root, textures, 2, {
    onFlourish: (f) => thrown.push(f),
    onSpotlight: (on) => spot.push(on),
  })
  const state = createRound(2, stackedDeck(...cards))
  view.beginRound(state)
  return { root, view, state, thrown, spot }
}

/** Play until one seat holds all seven, which ends the round. */
function sevenTable(): ReturnType<typeof recordingTable> {
  const t = recordingTable([n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(0)])
  play(t)
  answer(t, { kind: 'hit' })
  play(t)
  // The other seat banks, so the rest of the round is one player drawing.
  answer(t, { kind: 'stay' })
  play(t)
  for (let i = 0; i < 5; i++) {
    answer(t, { kind: 'hit' })
    play(t)
  }
  return t
}

describe('flourishes', () => {
  // A card arriving is the monster bringing it up, so the burst belongs at the
  // hole and not on the card. The mouth's own centre is well under the lip, so
  // a puff thrown from there would be behind it and nobody would see one.
  it('spits from the lip line rather than from inside the mouth', () => {
    const t = recordingTable([n(1), n(2)])
    play(t)
    const spits = t.thrown.filter((f) => f.kind === 'spit')
    expect(spits.length).toBeGreaterThan(0)
    for (const spit of spits) {
      expect(spit.at).toEqual(spitPoint())
      expect(spit.at.y).toBeLessThanOrEqual(BANNER.top)
    }
    // Nothing is thrown at the card itself as it sets down.
    expect(t.thrown.every((f) => f.kind === 'spit')).toBe(true)
  })

  // An aimed card used to stop existing at the reveal, so the table never
  // showed who it hit.
  it('carries an aimed card to the seat it hit and breaks it there', () => {
    for (const [action, kind, color] of [
      [freeze, 'shatter', COLORS.freeze],
      [threeMore, 'float', COLORS.threeMore],
    ] as const) {
      const t = recordingTable([n(1), n(2), action, n(3), n(4), n(5), n(6)])
      play(t)
      answer(t, { kind: 'hit' })
      play(t)
      expect(t.state.pending.kind, kind).toBe('target')

      const before = t.thrown.length
      answer(t, { kind: 'target', seat: 1 })
      const broke = t.thrown.slice(before).filter((f) => f.kind === kind)
      expect(broke, kind).toHaveLength(1)
      expect(broke[0]!.color, kind).toBe(color)
      // At the seat it was played at, not back in the middle of the table.
      const target = seatPlacements(2)[1]!.layout
      expect(Math.abs(broke[0]!.at.x - target.x), kind).toBeLessThan(1)
      expect(broke[0]!.at.y, kind).toBeLessThan(target.y)
    }
  })

  // A punishment and a gift arrive the same way and must not look alike.
  it('makes the two aimed cards arrive differently', () => {
    const [shatter] = burstFor({
      kind: 'shatter',
      at: { x: 0, y: 0 },
      color: COLORS.freeze,
    })
    const [float] = burstFor({
      kind: 'float',
      at: { x: 0, y: 0 },
      color: COLORS.threeMore,
    })
    expect(shatter!.gravity).toBeGreaterThan(float!.gravity)
  })

  it('leaves a card still in play alone', () => {
    const t = recordingTable([n(1), n(2), n(3), n(4)])
    play(t)
    // Every card dealt is in somebody's hand, so nothing has finished yet.
    expect(t.thrown.filter((f) => f.kind === 'dissolve')).toHaveLength(0)
  })

  // A duplicate either ends the hand or gets eaten, and the two used to look
  // almost the same: a spin, and then either grey or nothing.
  it('breaks the duplicate that ends a hand, on the spot it was read', () => {
    const t = recordingTable([n(1), n(2), n(1)])
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    const busts = t.thrown.filter((f) => f.kind === 'bust')
    expect(busts).toHaveLength(1)
    expect(Math.abs(busts[0]!.at.y - REVEAL.y)).toBeLessThan(1)
    expect(t.thrown.some((f) => f.kind === 'save')).toBe(false)
  })

  it('celebrates a duplicate an extra life eats, rather than breaking it', () => {
    const t = recordingTable([n(1), n(2), life, n(3), n(1)])
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    answer(t, { kind: 'hit' })
    play(t)
    expect(t.state.players[0]!.status).toBe('active')
    const saves = t.thrown.filter((f) => f.kind === 'save')
    expect(saves).toHaveLength(1)
    expect(Math.abs(saves[0]!.at.y - REVEAL.y)).toBeLessThan(1)
    expect(t.thrown.some((f) => f.kind === 'bust')).toBe(false)
  })

  // Reaching seven is the biggest thing that can happen in a round, and the
  // hand used to go straight home the moment it was complete.
  it('keeps the winning row up instead of sending it home', () => {
    const t = sevenTable()
    expect(t.state.ended).toBe('seven')
    const row = shown(t.root).map((c) => layoutFromWorld(c.transform.position))
    expect(row.length).toBeGreaterThanOrEqual(7)
    const lifted = row.filter((p) => Math.abs(p.y - FOCUS.centerY) < 1)
    expect(lifted).toHaveLength(7)
  })

  it('throws the winner their shape off every card of the row', () => {
    const t = sevenTable()
    const sevens = t.thrown.filter((f) => f.kind === 'seven')
    expect(sevens).toHaveLength(7)
    for (const f of sevens) expect(f.seat).toBe(0)
    // One per card, spread across the row rather than seven on one spot.
    const columns = new Set(sevens.map((f) => Math.round(f.at.x)))
    expect(columns.size).toBe(7)
  })

  it('closes the haze in for the row, and opens it again after', () => {
    const t = sevenTable()
    expect(t.spot.at(-1)).toBe(true)
    // What the session does once the round is scored.
    t.view.setActiveSeat(null, t.state)
    expect(t.spot.at(-1)).toBe(false)
  })

  // A round ending is not seven cards each deciding to explode.
  it('sweeps the table quietly at the end of a round', () => {
    const t = recordingTable([n(1), n(2), n(3), n(4)])
    play(t)
    const before = t.thrown.length
    t.view.clearRound()
    expect(t.thrown).toHaveLength(before)
  })
})
