/**
 * The Office Overtime session.
 *
 * Owns the scene, the match state and the turn pipeline, and exposes the same
 * control surface the other arcade games use: a `GameSession` with a typed
 * emitter that the Svelte overlays subscribe to.
 *
 * A turn is two steps, because the rules make it two: spending an approval to
 * redeal has to be committed before the new candidates can be seen. So the
 * human path is select-candidate then place, and the computer path is
 * `planTurn`, apply the approval, then `planHire` if it chose to redeal.
 *
 * Every async step shares one {@link AbortScope}. `startMatch`, `reset` and
 * `destroy` reset or dispose it, which unwinds whatever is in flight without
 * generation-counter guards. The scope's signal is threaded into every gameplay
 * tween as well, since `node.tween` otherwise scopes only to the node's own
 * lifetime and an in-flight card flight would survive into the next match.
 */
import {
  AbortScope,
  Node2D,
  bindRegionGesture,
  createEmitter,
  ignoreAbort,
  type Emitter,
  type EngineHost,
  type Rect,
} from '@src/stargazer'
import { GradientBackgroundNode } from '../../common/GradientBackgroundNode'
import { CardNode } from './nodes/CardNode'
import {
  cellRect,
  computeTable,
  orgGeom,
  shortlistSlots,
  type OrgGeom,
  type TableRects,
} from './layout'
import { ANIM, COLORS } from './tuning'
import { planHire, planTurn, type Random } from './ai'
import { describeDetail } from './rules/text'
import {
  applyApproval,
  applyHire,
  createMatch,
  finish,
  isOver,
  legalHires,
  legalPlacements,
  seatsFilled,
  type Hire,
  type MatchState,
  type PlayerId,
  type Slot,
} from './rules/match'
import { isOpenSeat, type Pos } from './rules/scoring'
import type {
  GameEvents,
  GameMode,
  SessionState,
  SideSummary,
  SideResultView,
} from './types'

export interface GameSession {
  readonly events: Emitter<GameEvents>
  readonly state: () => SessionState
  startMatch(mode: GameMode): void
  reset(): void
  pause(): void
  resume(): void
  resize(view: Rect): void
  destroy(): void
}

/** Which side a human controls in each mode. Player 0 is always on the left. */
const humanControls = (mode: GameMode, side: PlayerId): boolean =>
  mode.kind === 'versus' || side === 0

export async function startGame(
  host: EngineHost,
  view: Rect,
  seed = Math.floor(Math.random() * 0xffffffff),
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const engine = host.engine

  const root = new Node2D('office-overtime-root')
  engine.tree.root.add(root)
  const scope = new AbortScope(root.abortSignal)

  const backdrop = new GradientBackgroundNode({
    rect: view,
    topLeft: COLORS.backdropTop,
    bottomRight: COLORS.backdropBottom,
  })
  root.add(backdrop)

  const boardLayer = new Node2D('oo-board')
  root.add(boardLayer)
  // Always the last child of the root, so a card dragged out of a shortlist and
  // toward an org paints above both. Painter order is a global depth-first walk,
  // so re-adding a card to its own parent would only raise it above siblings.
  const dragLayer = new Node2D('oo-drag-layer')
  root.add(dragLayer)

  let table: TableRects = computeTable(view)
  let geom: [OrgGeom, OrgGeom] = [orgGeom(table.org[0]), orgGeom(table.org[1])]
  let slots: [Rect[], Rect[]] = [
    shortlistSlots(table.shortlist[0]),
    shortlistSlots(table.shortlist[1]),
  ]

  let state: SessionState = 'idle'
  let mode: GameMode = { kind: 'versus' }
  let match: MatchState = createMatch(seed)
  let rng: Random = Math.random
  let paused = false

  // Selected candidate, for the tap-to-place path.
  let selected: Slot | null = null
  let dragging: CardNode | null = null
  let dragFrom: { x: number; y: number } | null = null

  const orgCards: [Map<string, CardNode>, Map<string, CardNode>] = [
    new Map(),
    new Map(),
  ]
  const candidateCards = new Map<string, CardNode>()

  const key = (r: number, c: number): string => `${r},${c}`

  function summaries(): [SideSummary, SideSummary] {
    return match.sides.map((s) => ({
      budget: s.budget,
      approvals: s.approvals,
      seats: seatsFilled(s.grid),
    })) as [SideSummary, SideSummary]
  }

  function emitSides(): void {
    events.emit('sidesChanged', { sides: summaries() })
  }

  /** Rebuild every card node from the match state. */
  function sync(): void {
    for (const side of [0, 1] as PlayerId[]) {
      const g = geom[side]
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = match.sides[side].grid[r]![c] ?? null
          const id = key(r, c)
          const existing = orgCards[side].get(id)
          if (cell === null) {
            if (existing) {
              existing.destroy()
              orgCards[side].delete(id)
            }
            continue
          }
          const node = existing ?? new CardNode(`oo-org-${side}-${id}`)
          if (!existing) {
            orgCards[side].set(id, node)
            boardLayer.add(node)
          }
          node.setFace(
            isOpenSeat(cell)
              ? { kind: 'openSeat' }
              : { kind: 'card', card: cell.card, budget: cell.budget },
          )
          placeOrgCard(node, g, r, c)
        }
      }
    }

    for (const floor of ['management', 'ic'] as const) {
      const row = floor === 'management' ? 0 : 1
      for (let s = 0; s < 3; s++) {
        const card = match.shortlists[floor][s] ?? null
        const id = `${floor}-${s}`
        const existing = candidateCards.get(id)
        if (!card) {
          if (existing) {
            existing.destroy()
            candidateCards.delete(id)
          }
          continue
        }
        const node = existing ?? new CardNode(`oo-cand-${id}`)
        if (!existing) {
          candidateCards.set(id, node)
          boardLayer.add(node)
          bindCandidate(node, floor, s as Slot)
        }
        node.setFace({ kind: 'card', card, budget: 0 })
        const rect = slots[row][s]!
        node.setSize(rect.width, rect.height)
        node.transform.x = rect.x
        node.transform.y = rect.y
        node.setDimmed(!isPickable(floor, s as Slot))
      }
    }
    emitSides()
  }

  function placeOrgCard(
    node: CardNode,
    g: OrgGeom,
    r: number,
    c: number,
  ): void {
    const rect = cellRect(g, r - 1, c - 1)
    node.setSize(rect.width, rect.height)
    node.transform.x = rect.x
    node.transform.y = rect.y
  }

  /** Whether the player to move could take this candidate at all. */
  function isPickable(floor: 'management' | 'ic', slot: Slot): boolean {
    if (state !== 'playing' || paused) return false
    if (floor !== match.marker) return false
    if (!humanControls(mode, match.turn)) return false
    return legalHires(match).some((h) => h.slot === slot)
  }

  function legalSeats(): Pos[] {
    return legalPlacements(match.sides[match.turn].grid)
  }

  function bindCandidate(
    node: CardNode,
    floor: 'management' | 'ic',
    slot: Slot,
  ): void {
    node.bindPointer({
      singlePointer: true,
      down: (e) => {
        if (!isPickable(floor, slot)) return
        selected = slot
        dragging = node
        dragFrom = { x: node.transform.x, y: node.transform.y }
        node.setLifted(true)
        // Reparent so the card paints over the destination org, then rebase:
        // `transform.x/y` are parent-local and are not adjusted by the move.
        dragLayer.add(node)
        const p = e.localTo(dragLayer)
        node.transform.x = p.x - node.width / 2
        node.transform.y = p.y - node.height / 2
      },
      move: (e) => {
        if (dragging !== node) return
        const p = e.localTo(dragLayer)
        node.transform.x = p.x - node.width / 2
        node.transform.y = p.y - node.height / 2
      },
      up: (e) => {
        if (dragging !== node) return
        const p = e.pointer.world
        const seat = seatAt(match.turn, p.x, p.y)
        node.setLifted(false)
        dragging = null
        boardLayer.add(node)
        if (dragFrom) {
          node.transform.x = dragFrom.x
          node.transform.y = dragFrom.y
        }
        dragFrom = null
        if (seat) void commitHuman(slot, seat)
      },
      cancel: () => {
        if (dragging !== node) return
        node.setLifted(false)
        dragging = null
        boardLayer.add(node)
        if (dragFrom) {
          node.transform.x = dragFrom.x
          node.transform.y = dragFrom.y
        }
        dragFrom = null
      },
    })
  }

  /** The org seat under a world point, if it is a legal placement. */
  function seatAt(side: PlayerId, x: number, y: number): Pos | null {
    const g = geom[side]
    for (const pos of legalSeats()) {
      const rect = cellRect(g, pos.r - 1, pos.c - 1)
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        return pos
      }
    }
    return null
  }

  async function commitHuman(slot: Slot, at: Pos): Promise<void> {
    const hires = legalHires(match)
    const hire =
      hires.find(
        (h) => h.slot === slot && h.at.r === at.r && h.at.c === at.c,
      ) ?? null
    if (!hire) return
    selected = null
    applyApproval(match, 'none')
    applyHire(match, hire)
    sync()
    await afterTurn()
  }

  /** Advance past a completed turn: finish, or hand over to the computer. */
  async function afterTurn(): Promise<void> {
    if (isOver(match)) {
      endMatch()
      return
    }
    events.emit('turnChanged', { turn: match.turn, thinking: false })
    if (!humanControls(mode, match.turn)) {
      const signal = scope.signal
      await runComputerTurn(signal).catch(ignoreAbort)
    }
  }

  async function runComputerTurn(signal: AbortSignal): Promise<void> {
    if (mode.kind !== 'ai') return
    events.emit('turnChanged', { turn: match.turn, thinking: true })
    await engine.wait(ANIM.aiThinkDelay, signal)

    // The search is synchronous, so it is sliced and a frame is awaited between
    // slices. The abort check goes after the search rather than after the wait:
    // an aborted `wait` already rejects, so nothing downstream of it runs, but a
    // swipe out during the search itself must not commit a move.
    const plan = planTurn(match, mode.difficulty, rng)
    let step = plan.next()
    while (!step.done) {
      await engine.wait(0, signal)
      step = plan.next()
    }
    if (signal.aborted) return
    const planned = step.value
    if (!planned) return

    applyApproval(match, planned.approval)
    let hire: Hire | null = planned.hire
    if (!hire) {
      sync()
      const after = planHire(match, mode.difficulty, rng)
      let s2 = after.next()
      while (!s2.done) {
        await engine.wait(0, signal)
        s2 = after.next()
      }
      if (signal.aborted) return
      hire = s2.value
    }
    if (!hire) return
    applyHire(match, hire)
    sync()
    await afterTurn()
  }

  function endMatch(): void {
    state = 'gameOver'
    const result = finish(match)
    const sides = result.sides.map((side): SideResultView => {
      const lines = side.breakdown.seats
        .filter((s) => s.kind === 'card')
        .map((s) => ({
          name: s.kind === 'card' ? s.name : '',
          points: s.points,
          detail: s.kind === 'card' ? describeDetail(s.detail) : '',
        }))
      return {
        total: side.breakdown.total,
        approvals: side.breakdown.approvals,
        loose: side.loose,
        lines,
      }
    }) as [SideResultView, SideResultView]
    events.emit('gameOver', { sides, winner: result.winner })
  }

  const gesture = bindRegionGesture(engine, {
    enabled: () => state === 'playing' && !paused,
    hitTest: () => true,
    // A card's own binding captures the pointer first. The region gesture does
    // not check for that on its own, and `InputSystem` emits on the stage even
    // when a node has captured, so without this the board handler would track
    // the whole drag as well.
    down: (e) => {
      if (e.pointer.capturedBy) return
      if (selected === null) return
      const seat = seatAt(match.turn, e.pointer.world.x, e.pointer.world.y)
      if (seat) void commitHuman(selected, seat)
    },
    onReject: (e) => {
      if (e.pointer.capturedBy) return
      if (state === 'playing' && !paused) return
      selected = null
    },
  })

  function layout(next: Rect): void {
    table = computeTable(next)
    geom = [orgGeom(table.org[0]), orgGeom(table.org[1])]
    slots = [
      shortlistSlots(table.shortlist[0]),
      shortlistSlots(table.shortlist[1]),
    ]
    backdrop.setRect(next)
    sync()
  }

  const session: GameSession = {
    events,
    state: () => state,
    startMatch(next) {
      scope.reset()
      mode = next
      match = createMatch(seed + Math.floor(Math.random() * 0xffff))
      rng = Math.random
      selected = null
      state = 'playing'
      paused = false
      for (const map of orgCards) {
        for (const node of map.values()) node.destroy()
        map.clear()
      }
      for (const node of candidateCards.values()) node.destroy()
      candidateCards.clear()
      sync()
      events.emit('matchStarted', { mode: next })
      events.emit('turnChanged', { turn: match.turn, thinking: false })
      if (!humanControls(next, match.turn)) {
        const signal = scope.signal
        void runComputerTurn(signal).catch(ignoreAbort)
      }
    },
    reset() {
      scope.reset()
      state = 'idle'
      paused = false
      selected = null
      events.emit('reset', undefined)
    },
    pause() {
      if (state !== 'playing') return
      paused = true
      engine.setPaused(true)
      events.emit('paused', undefined)
    },
    resume() {
      paused = false
      engine.setPaused(false)
      events.emit('resumed', undefined)
    },
    resize(next) {
      layout(next)
    },
    destroy() {
      scope.dispose()
      gesture()
      root.destroy()
    },
  }

  sync()
  return session
}
