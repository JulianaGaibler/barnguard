/**
 * The Full Stack session.
 *
 * Owns the scene, the match state and the turn pipeline, and exposes the same
 * control surface the other arcade games use: a `GameSession` with a typed
 * emitter that the Svelte overlays subscribe to.
 *
 * A turn is two steps, because the rules make it two: spending an approval to
 * switch floor or redeal has to be committed before its effect can be seen,
 * then the mandatory hire is placed. The human path is optional approval
 * controls, then select-candidate and place. The computer path is `planTurn`,
 * apply the approval, then `planHire` if it chose to redeal.
 *
 * The board is built lazily: only the background mounts up front, and `sync`
 * builds card and control nodes only while a match is playing, so the splash
 * menu shows the empty board.
 *
 * Every async step shares one {@link AbortScope}. `startMatch`, `reset` and
 * `destroy` reset or dispose it, which unwinds whatever is in flight, such as a
 * running search or a `choose` prompt awaiting the player, without generation
 * guards.
 */
import {
  AbortScope,
  DraggableBehavior,
  Node2D,
  abortError,
  bindRegionGesture,
  createEmitter,
  easings,
  ignoreAbort,
  isAbortError,
  type Emitter,
  type EngineHost,
  rectContains,
  type Rect,
} from '@src/stargazer'
import { GradientBackgroundNode } from '../../common/GradientBackgroundNode'
import { loadIcons } from '../art/icons'
import { CardNode, type CardFaceKind } from './nodes/CardNode'
import { ButtonNode } from './nodes/ButtonNode'
import { ResourceBarNode } from './nodes/ResourceBarNode'
import { ShortlistCaptionNode } from './nodes/ShortlistCaptionNode'
import { ElevatorNode } from './nodes/ElevatorNode'
import { OrgFrameNode, type FrameCell } from './nodes/OrgFrameNode'
import { ScrimNode } from './nodes/ScrimNode'
import { MenuBackdropNode } from './nodes/MenuBackdropNode'
import {
  computeTable,
  helpFocus,
  placeAt,
  shortlistSlots,
  windowCellRect,
  type TableRects,
} from './layout'
import { ANIM, COLORS } from './tuning'
import { dealRow, entranceFor, rowTime, tossRow, type SlotShot } from './anim'
import { planHire, planTurn, type Random } from './ai'
import { describeDetail } from './rules/text'
import { optionFaceSpans } from './rules/glyphText'
import { choiceCount, previewAbility } from './rules/economy'
import {
  applyApproval,
  applyHire,
  bounds,
  createMatch,
  finish,
  isOver,
  legalHires,
  legalPlacements,
  seatsFilled,
  undoApproval,
  type ApprovalStep,
  type ApprovalUndo,
  type MatchResult,
  type MatchState,
  type PlayerId,
  type Slot,
} from './rules/match'
import { isFilled, isOpenSeat, type Pos } from './rules/scoring'
import type { Card, Effect, Floor } from './rules/deck'
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
  /** Put a card being explained back on the board, staying in help mode. */
  closeHelp(): void
  resize(view: Rect): void
  destroy(): void
}

/** Which side a human controls in each mode. Player 0 is always on the left. */
const humanControls = (mode: GameMode, side: PlayerId): boolean =>
  mode.kind === 'versus' || side === 0

const GRID = 5

interface OrgWindow {
  r0: number
  c0: number
  rows: number
  cols: number
}

const posEq = (a: Pos | null, b: Pos | null): boolean =>
  a === b || (a !== null && b !== null && a.r === b.r && a.c === b.c)

const picksEqual = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export async function startGame(
  host: EngineHost,
  view: Rect,
  seed = Math.floor(Math.random() * 0xffffffff),
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const engine = host.engine

  // The icons rasterize once. Awaiting here means the board never draws a frame
  // without them. The component guards the disposed race after this resolves.
  await loadIcons()

  const root = new Node2D('full-stack-root')
  engine.tree.root.add(root)
  const scope = new AbortScope(root.abortSignal)

  const backdrop = new GradientBackgroundNode({
    rect: view,
    topLeft: COLORS.backdropTop,
    bottomRight: COLORS.backdropBottom,
  })
  root.add(backdrop)

  // The wall of faces, over the gradient and under everything the game draws.
  // It carries the menu, so it goes dark for the length of a match.
  const wall = new MenuBackdropNode('fs-wall')
  root.add(wall)
  wall.setRect(view)

  // Org slot fills and drop placeholders sit under the cards. The dragged card
  // sits above everything. Painter order is a global depth-first walk.
  const frameLayer = new Node2D('fs-frames')
  const boardLayer = new Node2D('fs-board')
  const uiLayer = new Node2D('fs-ui')
  const dragLayer = new Node2D('fs-drag-layer')
  root.add(frameLayer)
  root.add(boardLayer)
  root.add(uiLayer)
  root.add(dragLayer)

  const orgFrames: [OrgFrameNode, OrgFrameNode] = [
    new OrgFrameNode('fs-frame-0'),
    new OrgFrameNode('fs-frame-1'),
  ]
  const resourceBars: [ResourceBarNode, ResourceBarNode] = [
    new ResourceBarNode('fs-res-0'),
    new ResourceBarNode('fs-res-1'),
  ]
  const captions: [ShortlistCaptionNode, ShortlistCaptionNode] = [
    new ShortlistCaptionNode('fs-cap-mgmt', 'management'),
    new ShortlistCaptionNode('fs-cap-ic', 'ic'),
  ]
  const elevator = new ElevatorNode('fs-elevator')
  const switchBtn = new ButtonNode('fs-switch', () => onSwitch())
  const redealBtn = new ButtonNode('fs-redeal', () => onRedeal())
  const flipBtn = new ButtonNode('fs-flip', () => onFlip())
  const helpBtn = new ButtonNode('fs-help', () => onHelp())
  helpBtn.setIcon('help', 'help-on')
  orgFrames.forEach((n) => frameLayer.add(n))
  resourceBars.forEach((n) => uiLayer.add(n))
  captions.forEach((n) => uiLayer.add(n))
  uiLayer.add(elevator)
  uiLayer.add(switchBtn)
  uiLayer.add(redealBtn)
  uiLayer.add(flipBtn)
  uiLayer.add(helpBtn)

  // The card being explained is lifted out of the board and drawn over a wash,
  // so both sit above the drag layer.
  const focusLayer = new Node2D('fs-focus')
  root.add(focusLayer)
  const scrim = new ScrimNode('fs-scrim')
  const focusCard = new CardNode('fs-focus-card')
  focusLayer.add(scrim)
  focusLayer.add(focusCard)
  scrim.setRect(view)
  scrim.visible = false
  focusCard.visible = false

  let viewRect: Rect = view
  let table: TableRects = computeTable(view)
  let slots: [Rect[], Rect[]] = [
    shortlistSlots(table.shortlist[0]),
    shortlistSlots(table.shortlist[1]),
  ]

  let state: SessionState = 'idle'
  let mode: GameMode = { kind: 'versus' }
  let match: MatchState = createMatch(seed)
  let rng: Random = Math.random
  let paused = false
  // Set once the match is scored. Its grids carry the budget the settlement
  // spread onto the budget lines, which the live grids never hold.
  let settled: MatchResult | null = null

  // What each shortlist slot held on the last pass, which is the only way to
  // tell a refill from a re-render: the map key is the slot, not the card.
  let shots = new Map<string, SlotShot>()
  // Cards on their way off the board. They are out of `candidateCards` so no
  // pass can see them, and out of every other lookup for the same reason, but
  // they are still on the scene until their exit lands.
  const leaving = new Set<CardNode>()
  // A seat waiting for the card that was hired into it, and how it should
  // arrive. Drained by the next pass, since a hire is always followed by one.
  let arriving: { key: string; side: PlayerId; from: Rect | null } | null = null
  // The computer walks the real board while it thinks, applying and undoing
  // hires between frames. A pass landing in one of those gaps is looking at a
  // position nobody played, so it paints and animates nothing.
  let searching = false

  // Per-turn control state for the human.
  //
  // Both approval steps are open on the same turn, so this is a stack rather
  // than a flag. Only the top of it can be undone, and only when it is a marker
  // move: an undo restores the snapshot taken before its own step, so unwinding
  // a switch made before a redeal would take the redeal back with it.
  let approvals: { step: ApprovalStep; undo: ApprovalUndo }[] = []
  let flipMode = false

  // Help is not per-turn state. It survives the handover, because the other
  // player's turn is when there is time to read.
  let helpMode = false
  let helpCard: Card | null = null

  // Selection state. `selected` is the candidate held for tap-to-place.
  // `hoverSeat` is the drop target the org frame highlights during a drag. The
  // drag mechanics themselves live in `DraggableBehavior` (see `bindCandidate`).
  let selected: Slot | null = null
  let hoverSeat: Pos | null = null

  // A `choose` card the human is resolving. The overlay calls it, with `null`
  // for a player who has changed their mind about the whole hire.
  let pendingChoice: ((index: number | null) => void) | null = null

  const orgCards: [Map<string, CardNode>, Map<string, CardNode>] = [
    new Map(),
    new Map(),
  ]
  const candidateCards = new Map<string, CardNode>()

  const key = (r: number, c: number): string => `${r},${c}`

  /** Every card node the board is showing, candidates first. */
  function* boardCards(): Generator<CardNode> {
    yield* candidateCards.values()
    yield* orgCards[0].values()
    yield* orgCards[1].values()
  }
  const floorRow = (floor: Floor): 0 | 1 => (floor === 'management' ? 0 : 1)

  function setUiVisible(visible: boolean): void {
    for (const n of [
      ...orgFrames,
      ...resourceBars,
      ...captions,
      elevator,
      switchBtn,
      redealBtn,
      flipBtn,
      helpBtn,
    ]) {
      n.visible = visible
    }
    wall.visible = !visible
  }

  function summaries(): [SideSummary, SideSummary] {
    return match.sides.map((s) => ({
      budget: s.budget,
      approvals: s.approvals,
      seats: seatsFilled(s.grid),
    })) as [SideSummary, SideSummary]
  }

  function sideName(side: PlayerId): string {
    if (mode.kind === 'ai') return side === 0 ? 'You' : 'AI'
    return `Player ${side + 1}`
  }

  const controlsActive = (): boolean =>
    state === 'playing' && !paused && humanControls(mode, match.turn)

  /** Bounding box of a side's placed cells in the 5x5 working grid. */
  function bbox(
    side: PlayerId,
  ): { minR: number; maxR: number; minC: number; maxC: number } | null {
    const grid = match.sides[side].grid
    let minR = GRID
    let maxR = -1
    let minC = GRID
    let maxC = -1
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (grid[r]![c]) {
          minR = Math.min(minR, r)
          maxR = Math.max(maxR, r)
          minC = Math.min(minC, c)
          maxC = Math.max(maxC, c)
        }
      }
    }
    return maxR < 0 ? null : { minR, maxR, minC, maxC }
  }

  const isActiveOrg = (side: PlayerId): boolean =>
    side === match.turn && controlsActive() && selected !== null

  /** Most-centred 3x3 window origin covering [lo, hi], clamped to the grid. */
  function restWindowStart(lo: number, hi: number): number {
    const min = Math.max(0, hi - 2)
    const max = Math.min(GRID - 3, lo)
    const desired = Math.round((lo + hi) / 2) - 1
    return Math.max(min, Math.min(max, desired))
  }

  function orgWindow(side: PlayerId): OrgWindow {
    const bb = bbox(side)
    if (!bb) return { r0: 1, c0: 1, rows: 3, cols: 3 }
    if (isActiveOrg(side)) {
      // Open to the placed box plus every legal seat, at most 4x4.
      let { minR, maxR, minC, maxC } = bb
      for (const p of legalSeats()) {
        minR = Math.min(minR, p.r)
        maxR = Math.max(maxR, p.r)
        minC = Math.min(minC, p.c)
        maxC = Math.max(maxC, p.c)
      }
      return {
        r0: minR,
        c0: minC,
        rows: maxR - minR + 1,
        cols: maxC - minC + 1,
      }
    }
    return {
      r0: restWindowStart(bb.minR, bb.maxR),
      c0: restWindowStart(bb.minC, bb.maxC),
      rows: 3,
      cols: 3,
    }
  }

  const inWindow = (win: OrgWindow, r: number, c: number): boolean =>
    r >= win.r0 && r < win.r0 + win.rows && c >= win.c0 && c < win.c0 + win.cols

  const cellRectFor = (
    side: PlayerId,
    r: number,
    c: number,
    win: OrgWindow,
  ): Rect =>
    windowCellRect(table.org[side], win.cols, win.rows, r - win.r0, c - win.c0)

  function legalSeats(): Pos[] {
    return legalPlacements(match.sides[match.turn].grid)
  }

  /**
   * Rebuild every card and control node from the match state.
   *
   * Also the only place motion starts. A card change has more causes than there
   * are call sites that could each announce one, so the pass compares what a
   * slot held against what it holds and plays whatever the difference is. That
   * covers the causes nobody thought of, which is most of them: switching
   * floors with the face-down toggle armed turns six cards over without going
   * anywhere near the toggle.
   */
  function sync(): void {
    if (state === 'idle') return
    // A settled board and a hypothetical one are both painted, never animated.
    const quiet = searching || settled !== null
    const next = new Map<string, SlotShot>()
    const dealt: CardNode[] = []

    for (const side of [0, 1] as PlayerId[]) {
      const win = orgWindow(side)
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const cell = match.sides[side].grid[r]![c] ?? null
          const id = key(r, c)
          const existing = orgCards[side].get(id)
          if (cell === null || !inWindow(win, r, c)) {
            // A card mid-flight is kept even once the window has moved past it,
            // since destroying it would end the motion rather than land it.
            if (existing && !existing.animating) {
              existing.destroy()
              orgCards[side].delete(id)
            }
            continue
          }
          const node = existing ?? new CardNode(`fs-org-${side}-${id}`)
          if (!existing) {
            orgCards[side].set(id, node)
            boardLayer.add(node)
          }
          const scored = settled ? scoredSeat(side, r, c) : null
          node.setFace(
            isOpenSeat(cell)
              ? { kind: 'openSeat' }
              : {
                  kind: 'card',
                  card: cell.card,
                  budget: scored?.budget ?? cell.budget,
                },
          )
          node.setScore(scored?.points ?? null)
          node.setHome(cellRectFor(side, r, c, win))
          // A hire arrives once, into the seat it was placed in. Everything
          // else takes its position straight away.
          const hire = arriving?.side === side && arriving.key === id
          if (hire) {
            const from = arriving?.from ?? null
            arriving = null
            if (from) node.travelFrom(from)
            else node.settleIn()
          } else if (!node.animating) {
            node.snapHome()
          }
        }
      }
      orgFrames[side].setCells(frameCells(side, win), frameRadius(side, win))
    }

    for (const floor of ['management', 'ic'] as const) {
      const row = floor === 'management' ? 0 : 1
      if (settled) {
        for (let s = 0; s < 3; s++) {
          candidateCards.get(`${floor}-${s}`)?.destroy()
          candidateCards.delete(`${floor}-${s}`)
        }
        continue
      }
      for (let s = 0; s < 3; s++) {
        const card = match.shortlists[floor][s] ?? null
        const id = `${floor}-${s}`
        const existing = candidateCards.get(id)
        if (!card) {
          if (existing) {
            existing.destroy()
            candidateCards.delete(id)
          }
          next.delete(id)
          continue
        }
        const node = existing ?? new CardNode(`fs-cand-${id}`)
        if (!existing) {
          candidateCards.set(id, node)
          boardLayer.add(node)
          bindCandidate(node, floor, s as Slot)
        }
        const faceDown = flipMode && isPickable(floor, s as Slot)
        const shot: SlotShot = { card, faceDown }
        const face: CardFaceKind = faceDown
          ? { kind: 'openSeat' }
          : { kind: 'card', card, budget: 0, pays: paysNow(card) }
        const move = quiet ? 'none' : entranceFor(shots.get(id) ?? null, shot)
        next.set(id, shot)

        const rect = slots[row][s]!
        node.setHome(rect)
        // Every card is worth asking about, so help mode drops the cues that
        // say which ones are in play.
        node.setFaded(!helpMode && floor !== match.marker)

        // A flip owns the face until it reaches its own crossing. Writing it
        // here would land the new face before the card has turned.
        if (move === 'flip') {
          node.flipTo(face)
          continue
        }
        node.setFace(face)
        if (move === 'deal') dealt.push(node)
        // A card the drag behavior holds, or one already in motion, owns its
        // own position until it is done with it.
        else if (node.parent !== dragLayer && !node.animating) node.snapHome()
      }
    }
    shots = next
    dealRow(dealt)

    updateResources()
    updateElevator()
    updateCaptions()
    updateControls()
    events.emit('sidesChanged', { sides: summaries() })
  }

  /**
   * What a settled seat came to: its points, and the budget the settlement put
   * on it.
   *
   * The breakdown is indexed over the cropped 3x3, while the board is still
   * drawn from the 5x5 working grid, so the seat has to be found through the
   * same crop `normalize` took.
   */
  function scoredSeat(
    side: PlayerId,
    r: number,
    c: number,
  ): { points: number; budget: number } | null {
    if (!settled) return null
    const b = bounds(match.sides[side].grid)
    if (!b) return null
    const row = r - b.minR
    const col = c - b.minC
    if (row < 0 || row > 2 || col < 0 || col > 2) return null
    const seat = settled.sides[side].breakdown.seats[row * 3 + col]
    if (!seat || seat.kind !== 'card') return null
    const cell = settled.sides[side].grid[row]?.[col] ?? null
    return {
      points: seat.points,
      budget: cell && isFilled(cell) ? cell.budget : 0,
    }
  }

  /**
   * What a candidate's scaling effects would pay the player to move.
   *
   * Read off the org rather than the card, so it is the answer for whoever is
   * choosing right now and it moves as the org fills.
   */
  function paysNow(card: Card): (number | null)[] {
    const me = match.sides[match.turn]
    const them = match.sides[match.turn === 0 ? 1 : 0]
    return previewAbility(card, me, them)
  }

  function frameRadius(side: PlayerId, win: OrgWindow): number {
    return cellRectFor(side, win.r0, win.c0, win).width * 0.09
  }

  // Only the legal drop targets of the org being placed into, and only while a
  // card is in hand. An always-on grid of empty slots telegraphs the 3x3 shape
  // and biases where players build, so at rest the org shows just its cards.
  function frameCells(side: PlayerId, win: OrgWindow): FrameCell[] {
    if (!isActiveOrg(side)) return []
    const cells: FrameCell[] = []
    for (const p of legalSeats()) {
      if (!inWindow(win, p.r, p.c)) continue
      cells.push({
        rect: cellRectFor(side, p.r, p.c, win),
        kind: posEq(hoverSeat, p) ? 'hover' : 'placeholder',
      })
    }
    return cells
  }

  function updateResources(): void {
    for (const side of [0, 1] as PlayerId[]) {
      placeAt(resourceBars[side], table.resources[side])
      resourceBars[side].setLabel(sideName(side))
      // Once the match is settled the budget has been poured onto the budget
      // lines, so the bar shows what would not fit rather than what was held.
      resourceBars[side].setValues(
        match.sides[side].approvals,
        settled ? settled.sides[side].loose : match.sides[side].budget,
      )
      resourceBars[side].setActive(match.turn === side && state === 'playing')
      // The right-hand bar reads outward from the centre of the table.
      resourceBars[side].setMirrored(side === 1)
    }
  }

  /** The floor the car is parked on, so a move can be told from a repaint. */
  let liftFloor: Floor | null = null

  function updateElevator(): void {
    const rows = [table.shortlist[0], table.shortlist[1]]
    elevator.setGeom(
      table.elevator,
      rows[0]!.y + rows[0]!.height / 2,
      rows[1]!.y + rows[1]!.height / 2,
    )
    elevator.goTo(
      match.marker,
      liftFloor !== null && liftFloor !== match.marker,
    )
    liftFloor = match.marker
  }

  function updateCaptions(): void {
    const rows: Floor[] = ['management', 'ic']
    rows.forEach((floor, i) => {
      placeAt(captions[i]!, table.captions[i]!)
      // The marker says where you may hire from, which is not a distinction
      // help mode makes.
      captions[i]!.setActive(helpMode || match.marker === floor)
    })
  }

  function updateControls(): void {
    positionControls()
    // Nothing on the board can be spent while a tap means a question.
    const active = controlsActive() && !helpMode
    const held = match.sides[match.turn].approvals
    if (canUndoSwitch()) {
      switchBtn.setLabel('Undo switch')
      switchBtn.setPrice(0)
      switchBtn.setEnabled(active)
    } else {
      switchBtn.setLabel('Switch floor')
      switchBtn.setPrice(1)
      switchBtn.setEnabled(active && held > 0 && !taken('moveMarker'))
    }
    redealBtn.setLabel('Redeal floor')
    redealBtn.setPrice(1)
    redealBtn.setEnabled(active && held > 0 && !taken('refreshFloor'))
    flipBtn.setLabel(
      'Replace employee with AI',
      'Get resources at the expense of a slot',
    )
    flipBtn.setChecked(flipMode)
    flipBtn.setEnabled(active)
    helpBtn.setChecked(helpMode)
    // Reading a card is not a move, so this stays live on the other player's
    // turn while everything above it is greyed out.
    helpBtn.setEnabled(state === 'playing' && !paused)
  }

  function positionControls(): void {
    const c = table.controls
    const gap = c.height * 0.06
    const rowH = (c.height - gap) / 2
    const halfW = (c.width - gap) / 2
    const lower = c.y + rowH + gap
    placeAt(switchBtn, { x: c.x, y: c.y, width: halfW, height: rowH })
    placeAt(redealBtn, {
      x: c.x + halfW + gap,
      y: c.y,
      width: halfW,
      height: rowH,
    })
    // The help toggle is square on the end of the bottom row, which the flip
    // button gives up the width for.
    placeAt(flipBtn, {
      x: c.x,
      y: lower,
      width: c.width - rowH - gap,
      height: rowH,
    })
    placeAt(helpBtn, {
      x: c.x + c.width - rowH,
      y: lower,
      width: rowH,
      height: rowH,
    })
  }

  /** Whether the player to move could take this candidate at all. */
  function isPickable(floor: Floor, slot: Slot): boolean {
    // Help takes the tap. A disabled drag never captures the pointer, so the
    // press reaches the board handler that routes it.
    if (helpMode) return false
    if (!controlsActive()) return false
    if (floor !== match.marker) return false
    return legalHires(match).some((h) => h.slot === slot)
  }

  function refreshFrames(): void {
    const side = match.turn
    orgFrames[side].setCells(
      frameCells(side, orgWindow(side)),
      frameRadius(side, orgWindow(side)),
    )
  }

  // The drag mechanics (threshold, drag-layer lift, follow, snap-back) live in
  // the engine's DraggableBehavior. This wires the game's targets and commit.
  // The dragged card is lifted into `dragLayer`, which `sync()` skips, so a drag
  // and its snap-back are never fought by a layout pass.
  function bindCandidate(node: CardNode, floor: Floor, slot: Slot): void {
    node.addBehavior(
      new DraggableBehavior<Pos>({
        enabled: () => isPickable(floor, slot),
        dragLayer,
        // `seatAt` returns a fresh Pos each call, so dedupe by value.
        findDropTarget: (w) => seatAt(match.turn, w.x, w.y),
        equals: posEq,
        onDragStart: () => {
          selected = slot
          node.setLifted(true)
          sync()
        },
        onDragMove: (seat) => {
          hoverSeat = seat
          refreshFrames()
        },
        onDrop: (seat) => {
          // The behaviour reparents the card home before this runs, so by now
          // it is back in its slot even though the player's hand left it at the
          // seat. Flying it from the slot would replay the drag they just made.
          void commitHuman(slot, seat, 'drag').catch(ignoreAbort)
        },
        onDragCancel: () => {
          selected = null
          hoverSeat = null
          sync()
        },
        onSettled: () => node.setLifted(false),
        onTap: () => {
          selected = slot
          sync()
        },
      }),
    )
  }

  /** The org seat under a world point, if it is a legal placement in the window. */
  function seatAt(side: PlayerId, x: number, y: number): Pos | null {
    const win = orgWindow(side)
    for (const pos of legalSeats()) {
      if (!inWindow(win, pos.r, pos.c)) continue
      if (rectContains(cellRectFor(side, pos.r, pos.c, win), x, y)) return pos
    }
    return null
  }

  const taken = (step: ApprovalStep): boolean =>
    approvals.some((a) => a.step === step)

  /** A switch is reversible only while nothing has been spent on top of it. */
  const canUndoSwitch = (): boolean =>
    approvals[approvals.length - 1]?.step === 'moveMarker'

  function spend(step: ApprovalStep): void {
    if (!controlsActive() || taken(step)) return
    if (match.sides[match.turn].approvals <= 0) return
    if (step === 'refreshFloor') releaseRow(match.marker)
    approvals.push({ step, undo: applyApproval(match, [step]) })
    sync()
  }

  /**
   * Hand the floor's three candidates over to their exit.
   *
   * They leave `candidateCards` first, so the pass that deals their
   * replacements builds fresh nodes rather than reusing these. `leaving` is
   * what keeps them reachable, since nothing else looks at them now.
   */
  function releaseRow(floor: Floor): void {
    const row: CardNode[] = []
    for (let s = 0; s < 3; s++) {
      const id = `${floor}-${s}`
      const node = candidateCards.get(id)
      if (!node) continue
      candidateCards.delete(id)
      shots.delete(id)
      leaving.add(node)
      node.events.on('destroy', () => leaving.delete(node))
      row.push(node)
    }
    tossRow(row, table.shortlist[0].width * 0.35)
  }

  function onSwitch(): void {
    if (!controlsActive()) return
    if (canUndoSwitch()) {
      undoApproval(match, approvals.pop()!.undo)
      sync()
      return
    }
    spend('moveMarker')
  }

  function onRedeal(): void {
    spend('refreshFloor')
  }

  function onFlip(): void {
    if (!controlsActive()) return
    flipMode = !flipMode
    sync()
  }

  /** Disarm help and put the board back, however the mode is being left. */
  function closeHelpMode(): void {
    helpMode = false
    showHelp(null)
    events.emit('helpMode', false)
  }

  function onHelp(): void {
    if (state !== 'playing' || paused) return
    helpMode = !helpMode
    // Arming takes the tap away from placement, so a candidate held in hand
    // would leave its drop targets lit with no way to use them.
    if (helpMode) selected = null
    else showHelp(null)
    events.emit('helpMode', helpMode)
    sync()
  }

  /** The card drawn under a world point, ignoring seats taken face down. */
  function cardAt(x: number, y: number): Card | null {
    for (const node of boardCards()) {
      if (!node.visible || !node.hitTest(x, y)) continue
      const face = node.face
      return face && face.kind === 'card' ? face.card : null
    }
    return null
  }

  /**
   * Lift `card` out of the board, or put the board back when it is null.
   *
   * The one node is reused, so opening a second card while the first is still
   * flying snaps the face across and starts again from the new seat. The tween
   * is keyed so the two do not fight over the transform.
   */
  function showHelp(card: Card | null, from?: Rect): void {
    helpCard = card
    scrim.visible = card !== null
    focusCard.visible = card !== null
    events.emit('help', card ? { card } : null)
    if (!card) return

    const focus = helpFocus(viewRect).card
    focusCard.setFace({ kind: 'card', card, budget: 0 })
    // Sized to where it is going and scaled down to the seat it left, so the
    // flight is one transform rather than a resize every frame.
    const at = from ?? focus
    const start = from ? from.width / focus.width : 1
    focusCard.setSize(focus.width, focus.height)
    focusCard.transform.x = at.x
    focusCard.transform.y = at.y
    focusCard.transform.scaleX = start
    focusCard.transform.scaleY = start
    void engine
      .animate(
        focusCard,
        { x: focus.x, y: focus.y, scaleX: 1, scaleY: 1 },
        {
          duration: ANIM.helpFocus,
          easing: easings.outCubic,
          key: 'fs-help-focus',
        },
      )
      .catch(ignoreAbort)
  }

  /** The rect of the node currently drawing `card`, for the tween to start at. */
  function seatOf(card: Card): Rect | undefined {
    for (const node of boardCards()) {
      const face = node.face
      if (!node.visible || !face || face.kind !== 'card') continue
      if (face.card !== card) continue
      return {
        x: node.transform.x,
        y: node.transform.y,
        width: node.width,
        height: node.height,
      }
    }
    return undefined
  }

  /** Resolve a `choose` card's option(s) through the overlay, one per choice. */
  async function collectPicks(card: Card): Promise<number[]> {
    const picks: number[] = []
    for (const e of card.ability) {
      if (e.effect !== 'choose') continue
      picks.push(await promptChoice(card, e.options))
    }
    return picks
  }

  /**
   * Ask the player which branch of a `choose` card to take.
   *
   * Cancelling rejects the same way a teardown does, since backing out of the
   * question is backing out of the hire, and `commitHuman` already unwinds an
   * abort by putting the board back the way it was.
   */
  function promptChoice(card: Card, options: Effect[][]): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (scope.signal.aborted) {
        reject(abortError())
        return
      }
      const close = (): void => {
        pendingChoice = null
        events.emit('choice', null)
      }
      const onAbort = (): void => {
        close()
        reject(abortError())
      }
      scope.signal.addEventListener('abort', onAbort, { once: true })
      pendingChoice = (index): void => {
        scope.signal.removeEventListener('abort', onAbort)
        close()
        if (index === null) reject(abortError())
        else resolve(index)
      }
      events.emit('choice', {
        card,
        options: options.map(optionFaceSpans),
        pick: (index) => pendingChoice?.(index),
        cancel: () => pendingChoice?.(null),
      })
    })
  }

  async function commitHuman(
    slot: Slot,
    at: Pos,
    gesture: 'drag' | 'tap',
  ): Promise<void> {
    if (!controlsActive()) return
    // A placement attempt takes the card out of hand, so the drop zones clear
    // whether or not the hire turns out to be legal.
    selected = null
    hoverSeat = null
    const card = match.shortlists[match.marker][slot]
    if (!card) {
      sync()
      return
    }
    const take: 'hire' | 'openSeat' = flipMode ? 'openSeat' : 'hire'

    let picks: number[] = []
    if (take === 'hire' && choiceCount(card) > 0) {
      try {
        picks = await collectPicks(card)
      } catch (e) {
        if (!isAbortError(e)) throw e
        // A cancelled prompt leaves the candidate where it was, and `sync` is
        // what puts the dragged card back in its slot. On a teardown the state
        // is already idle by now and `sync` returns without touching anything.
        sync()
        return
      }
      // A swipe-out or a new match could have landed while the prompt was open.
      if (state !== 'playing') return
    }

    const wantPicks = take === 'hire' ? picks : []
    const hire =
      legalHires(match).find(
        (h) =>
          h.take === take &&
          h.slot === slot &&
          h.at.r === at.r &&
          h.at.c === at.c &&
          picksEqual(h.picks, wantPicks),
      ) ?? null
    if (!hire) {
      sync()
      return
    }

    // Captured here and nowhere earlier: a `choose` prompt can hold this
    // function open indefinitely, and any pass during that wait would drain it.
    arriving = {
      key: key(at.r, at.c),
      side: match.turn,
      from:
        gesture === 'tap'
          ? (slots[floorRow(match.marker)][slot] ?? null)
          : null,
    }
    applyHire(match, hire)
    sync()
    await afterTurn()
  }

  /** Reset the per-turn control state for the side now to move. */
  function resetTurnControls(): void {
    approvals = []
    flipMode = false
    hoverSeat = null
  }

  /** Advance past a completed turn: finish, or hand over to the computer. */
  async function afterTurn(): Promise<void> {
    if (isOver(match)) {
      endMatch()
      return
    }
    resetTurnControls()
    events.emit('turnChanged', { turn: match.turn, thinking: false })
    sync()
    if (!humanControls(mode, match.turn)) {
      await runComputerTurn(scope.signal).catch(ignoreAbort)
    }
  }

  /**
   * Drive a sliced search to its answer, one slice per frame.
   *
   * The search is synchronous, so it is cut into slices with a frame awaited
   * between them. It applies and undoes hires on the real board across those
   * gaps, so `searching` tells `sync` that any pass landing in one is looking
   * at a position nobody played.
   *
   * Returns null on an abort. An aborted `wait` rejects, so nothing downstream
   * runs, but a swipe-out during the last slice has to be caught here or the
   * move it found gets committed.
   */
  async function runSearch<T>(
    search: Generator<unknown, T | null>,
    signal: AbortSignal,
  ): Promise<T | null> {
    searching = true
    try {
      let step = search.next()
      while (!step.done) {
        await engine.wait(0, signal)
        step = search.next()
      }
      return signal.aborted ? null : step.value
    } finally {
      searching = false
    }
  }

  async function runComputerTurn(signal: AbortSignal): Promise<void> {
    if (mode.kind !== 'ai') return
    events.emit('turnChanged', { turn: match.turn, thinking: true })
    await engine.wait(ANIM.aiThinkDelay, signal)

    const planned = await runSearch(
      planTurn(match, mode.difficulty, rng),
      signal,
    )
    if (!planned) return

    // Each step of the turn is shown before the next one starts, and paced on
    // the clock rather than on the motion itself. A tween is scoped to its node
    // and rejects when a layout pass reclaims it, which would take the rest of
    // the turn with it.
    if (planned.approval.includes('refreshFloor'))
      releaseRow(nextFloor(planned))
    applyApproval(match, planned.approval)
    sync()
    if (planned.approval.length > 0) {
      await engine.wait(ANIM.dealIn + ANIM.beat, signal)
    }

    const hire =
      planned.hire ??
      (await runSearch(planHire(match, mode.difficulty, rng), signal))
    if (!hire) return
    // A pause on the chosen card before it moves, so the hire reads as a
    // decision rather than as the tail of whatever came before it.
    await engine.wait(ANIM.beat, signal)
    arriving = {
      key: key(hire.at.r, hire.at.c),
      side: match.turn,
      from: slots[floorRow(match.marker)][hire.slot] ?? null,
    }
    applyHire(match, hire)
    sync()
    // The board is already correct, so this is pacing. `afterTurn` runs either
    // way, since it is what ends the match.
    try {
      await engine.wait(ANIM.travel, signal)
    } finally {
      await afterTurn()
    }
  }

  /** The floor a plan redeals, which is the one it ends its marker moves on. */
  function nextFloor(planned: { approval: readonly ApprovalStep[] }): Floor {
    const moves = planned.approval
      .slice(0, planned.approval.indexOf('refreshFloor'))
      .filter((step) => step === 'moveMarker').length
    if (moves % 2 === 0) return match.marker
    return match.marker === 'management' ? 'ic' : 'management'
  }

  function endMatch(): void {
    state = 'gameOver'
    const result = finish(match)
    settled = result
    settleAll()
    closeHelpMode()
    // The centre column is where the breakdown goes, so nothing is left in it.
    const gone = [...captions, elevator, switchBtn, redealBtn, flipBtn, helpBtn]
    for (const n of gone) {
      n.visible = false
    }
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
    sync()
    events.emit('gameOver', { sides, winner: result.winner })
  }

  const gesture = bindRegionGesture(engine, {
    enabled: () => state === 'playing' && !paused,
    hitTest: () => true,
    // A card's or button's own binding captures the pointer first. The region
    // gesture does not check that on its own, and `InputSystem` emits on the
    // stage even when a node has captured, so without this the board handler
    // would track a card drag too.
    down: (e) => {
      if (helpMode) {
        // A card still captures the pointer while its drag behaviour is off,
        // since capture follows the hit test rather than the behaviour, so the
        // capture cannot be used to tell a card apart from the board here. Only
        // the buttons keep their own press. A press on anything else is a
        // question, and a press on nothing puts the board back.
        if (e.pointer.capturedBy instanceof ButtonNode) return
        const card = cardAt(e.pointer.world.x, e.pointer.world.y)
        showHelp(card, card ? seatOf(card) : undefined)
        return
      }
      if (e.pointer.capturedBy) return
      if (selected === null) return
      const seat = seatAt(match.turn, e.pointer.world.x, e.pointer.world.y)
      if (seat) void commitHuman(selected, seat, 'tap').catch(ignoreAbort)
    },
    onReject: (e) => {
      if (e.pointer.capturedBy) return
      if (state === 'playing' && !paused) return
      selected = null
    },
  })

  function layout(next: Rect): void {
    viewRect = next
    table = computeTable(next)
    slots = [
      shortlistSlots(table.shortlist[0]),
      shortlistSlots(table.shortlist[1]),
    ]
    backdrop.setRect(next)
    wall.setRect(next)
    scrim.setRect(next)
    // The sheet is measured from the same view by the overlay, which reflows on
    // its own. A focused card is mid-transform and has to be put back by hand
    // or the two part company.
    if (helpCard) snapFocus()
    if (state !== 'idle') sync()
  }

  function snapFocus(): void {
    const focus = helpFocus(viewRect).card
    // Same key on the same transform, so this displaces the flight rather than
    // racing it. Its target was measured against the view before the resize.
    void engine
      .animate(focusCard, {}, { duration: 0, key: 'fs-help-focus' })
      .catch(ignoreAbort)
    placeAt(focusCard, focus)
    focusCard.transform.scaleX = 1
    focusCard.transform.scaleY = 1
  }

  /** End every card's motion, leaving each where the layout wants it. */
  function settleAll(): void {
    for (const node of leaving) node.destroy()
    leaving.clear()
    for (const node of boardCards()) node.snapHome()
  }

  function teardownCards(): void {
    // Cards on their way out are in no map, so they have to be swept by hand or
    // they float over the next match for the rest of their exit.
    for (const node of leaving) node.destroy()
    leaving.clear()
    for (const node of boardCards()) node.destroy()
    for (const map of orgCards) map.clear()
    candidateCards.clear()
    shots.clear()
    arriving = null
    for (const frame of orgFrames) frame.setCells([], 0)
  }

  const session: GameSession = {
    events,
    state: () => state,
    startMatch(next) {
      scope.reset()
      mode = next
      match = createMatch(seed + Math.floor(Math.random() * 0xffff))
      rng = Math.random
      settled = null
      selected = null
      liftFloor = null
      closeHelpMode()
      resetTurnControls()
      state = 'playing'
      paused = false
      teardownCards()
      setUiVisible(true)
      sync()
      events.emit('matchStarted', { mode: next })
      events.emit('turnChanged', { turn: match.turn, thinking: false })
      if (!humanControls(next, match.turn)) {
        // Who opens is a coin flip, so the computer leads half of all matches.
        // Its first move waits for the deal it would otherwise land on top of.
        const dealt = rowTime(3)
        void engine
          .wait(dealt, scope.signal)
          .then(() => runComputerTurn(scope.signal))
          .catch(ignoreAbort)
      }
    },
    reset() {
      scope.reset()
      state = 'idle'
      paused = false
      engine.setPaused(false)
      settled = null
      selected = null
      closeHelpMode()
      pendingChoice = null
      resetTurnControls()
      teardownCards()
      setUiVisible(false)
      events.emit('choice', null)
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
    closeHelp() {
      showHelp(null)
    },
    resize(next) {
      layout(next)
    },
    destroy() {
      engine.setPaused(false)
      scope.dispose()
      gesture()
      root.destroy()
    },
  }

  setUiVisible(false)
  return session
}
