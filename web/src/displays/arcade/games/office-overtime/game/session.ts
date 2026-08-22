/**
 * The Office Overtime session.
 *
 * Owns the scene, the match state and the turn pipeline, and exposes the same
 * control surface the other arcade games use: a `GameSession` with a typed
 * emitter that the Svelte overlays subscribe to.
 *
 * A turn is two steps, because the rules make it two: spending an approval to
 * switch floor or redeal has to be committed before its effect can be seen,
 * then the mandatory hire is placed. The human path is optional approval
 * controls, then select-candidate and place; the computer path is `planTurn`,
 * apply the approval, then `planHire` if it chose to redeal.
 *
 * The board is built lazily: only the background mounts up front, and `sync`
 * builds card and control nodes only while a match is playing, so the splash
 * menu shows the empty board.
 *
 * Every async step shares one {@link AbortScope}. `startMatch`, `reset` and
 * `destroy` reset or dispose it, which unwinds whatever is in flight — a
 * running search, or a `choose` prompt awaiting the player — without generation
 * guards.
 */
import {
  AbortScope,
  DraggableBehavior,
  Node2D,
  abortError,
  bindRegionGesture,
  createEmitter,
  ignoreAbort,
  isAbortError,
  type Emitter,
  type EngineHost,
  type Rect,
} from '@src/stargazer'
import { GradientBackgroundNode } from '../../common/GradientBackgroundNode'
import { loadIcons } from '../art/icons'
import { CardNode } from './nodes/CardNode'
import { ButtonNode } from './nodes/ButtonNode'
import { ResourceBarNode } from './nodes/ResourceBarNode'
import { ShortlistCaptionNode } from './nodes/ShortlistCaptionNode'
import { OrgFrameNode, type FrameCell } from './nodes/OrgFrameNode'
import {
  computeTable,
  shortlistSlots,
  windowCellRect,
  type TableRects,
} from './layout'
import { ANIM, COLORS } from './tuning'
import { planHire, planTurn, type Random } from './ai'
import { describeDetail, describeOptionSpans } from './rules/text'
import { choiceCount } from './rules/economy'
import {
  applyApproval,
  applyHire,
  createMatch,
  finish,
  isOver,
  legalHires,
  legalPlacements,
  seatsFilled,
  undoApproval,
  type ApprovalUndo,
  type Hire,
  type MatchState,
  type PlayerId,
  type Slot,
} from './rules/match'
import { isOpenSeat, type Pos } from './rules/scoring'
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

  // The icons rasterize once; awaiting here means the board never draws a frame
  // without them. The component guards the disposed race after this resolves.
  await loadIcons()

  const root = new Node2D('office-overtime-root')
  engine.tree.root.add(root)
  const scope = new AbortScope(root.abortSignal)

  const backdrop = new GradientBackgroundNode({
    rect: view,
    topLeft: COLORS.backdropTop,
    bottomRight: COLORS.backdropBottom,
  })
  root.add(backdrop)

  // Org slot fills and drop placeholders sit under the cards; the dragged card
  // sits above everything. Painter order is a global depth-first walk.
  const frameLayer = new Node2D('oo-frames')
  const boardLayer = new Node2D('oo-board')
  const uiLayer = new Node2D('oo-ui')
  const dragLayer = new Node2D('oo-drag-layer')
  root.add(frameLayer)
  root.add(boardLayer)
  root.add(uiLayer)
  root.add(dragLayer)

  const orgFrames: [OrgFrameNode, OrgFrameNode] = [
    new OrgFrameNode('oo-frame-0'),
    new OrgFrameNode('oo-frame-1'),
  ]
  const resourceBars: [ResourceBarNode, ResourceBarNode] = [
    new ResourceBarNode('oo-res-0'),
    new ResourceBarNode('oo-res-1'),
  ]
  const captions: [ShortlistCaptionNode, ShortlistCaptionNode] = [
    new ShortlistCaptionNode('oo-cap-mgmt', 'management', 'MANAGEMENT'),
    new ShortlistCaptionNode('oo-cap-ic', 'ic', 'INDIVIDUAL CONTRIBUTORS'),
  ]
  const switchBtn = new ButtonNode('oo-switch', () => onSwitch())
  const redealBtn = new ButtonNode('oo-redeal', () => onRedeal())
  const flipBtn = new ButtonNode('oo-flip', () => onFlip())
  orgFrames.forEach((n) => frameLayer.add(n))
  resourceBars.forEach((n) => uiLayer.add(n))
  captions.forEach((n) => uiLayer.add(n))
  uiLayer.add(switchBtn)
  uiLayer.add(redealBtn)
  uiLayer.add(flipBtn)

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

  // Per-turn control state for the human.
  let pendingApproval: ApprovalUndo | null = null
  let approvalTaken = false
  let flipMode = false

  // Selection state. `selected` is the candidate held for tap-to-place;
  // `hoverSeat` is the drop target the org frame highlights during a drag. The
  // drag mechanics themselves live in `DraggableBehavior` (see `bindCandidate`).
  let selected: Slot | null = null
  let hoverSeat: Pos | null = null

  // A `choose` card the human is resolving; the overlay calls it.
  let pendingChoice: ((index: number) => void) | null = null

  const orgCards: [Map<string, CardNode>, Map<string, CardNode>] = [
    new Map(),
    new Map(),
  ]
  const candidateCards = new Map<string, CardNode>()

  const key = (r: number, c: number): string => `${r},${c}`

  function setUiVisible(visible: boolean): void {
    for (const n of [
      ...orgFrames,
      ...resourceBars,
      ...captions,
      switchBtn,
      redealBtn,
      flipBtn,
    ]) {
      n.visible = visible
    }
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

  /** Rebuild every card and control node from the match state. */
  function sync(): void {
    if (state === 'idle') return

    for (const side of [0, 1] as PlayerId[]) {
      const win = orgWindow(side)
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const cell = match.sides[side].grid[r]![c] ?? null
          const id = key(r, c)
          const existing = orgCards[side].get(id)
          if (cell === null || !inWindow(win, r, c)) {
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
          const rect = cellRectFor(side, r, c, win)
          node.setSize(rect.width, rect.height)
          node.transform.x = rect.x
          node.transform.y = rect.y
        }
      }
      orgFrames[side].setCells(frameCells(side, win), frameRadius(side, win))
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
        node.setFace(
          flipMode && isPickable(floor, s as Slot)
            ? { kind: 'openSeat' }
            : { kind: 'card', card, budget: 0 },
        )
        // A card the drag behavior has lifted into the drag layer (during the
        // drag or its snap-back) owns its own position; don't fight it.
        if (node.parent === dragLayer) continue
        const rect = slots[row][s]!
        node.setSize(rect.width, rect.height)
        node.transform.x = rect.x
        node.transform.y = rect.y
        const onActiveFloor = floor === match.marker
        node.transform.alpha = onActiveFloor ? 1 : 0.45
        node.setDimmed(
          onActiveFloor && flipMode && isPickable(floor, s as Slot),
        )
      }
    }

    updateResources()
    updateCaptions()
    updateControls()
    events.emit('sidesChanged', { sides: summaries() })
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
      const r = table.resources[side]
      resourceBars[side].setSize(r.width, r.height)
      resourceBars[side].transform.x = r.x
      resourceBars[side].transform.y = r.y
      resourceBars[side].setLabel(sideName(side))
      resourceBars[side].setValues(
        match.sides[side].approvals,
        match.sides[side].budget,
      )
      resourceBars[side].setActive(match.turn === side && state === 'playing')
    }
  }

  function updateCaptions(): void {
    const rows: Floor[] = ['management', 'ic']
    rows.forEach((floor, i) => {
      const cap = table.captions[i]!
      captions[i]!.setSize(cap.width, cap.height)
      captions[i]!.transform.x = cap.x
      captions[i]!.transform.y = cap.y
      captions[i]!.setActive(match.marker === floor)
    })
  }

  function updateControls(): void {
    positionControls()
    const active = controlsActive()
    const approvals = match.sides[match.turn].approvals
    if (pendingApproval) {
      switchBtn.setLabel('Undo switch', 'refund')
      switchBtn.setEnabled(active)
    } else {
      switchBtn.setLabel('Switch floor', '1 approval')
      switchBtn.setEnabled(active && approvals > 0 && !approvalTaken)
    }
    redealBtn.setLabel('Redeal floor', '1 approval')
    redealBtn.setEnabled(
      active && approvals > 0 && !approvalTaken && !pendingApproval,
    )
    flipBtn.setLabel('Replace with AI', 'face down: +6k, +2 approvals')
    flipBtn.setChecked(flipMode)
    flipBtn.setEnabled(active)
  }

  function positionControls(): void {
    const c = table.controls
    const gap = c.height * 0.06
    const rowH = (c.height - gap) / 2
    const halfW = (c.width - gap) / 2
    switchBtn.setSize(halfW, rowH)
    switchBtn.transform.x = c.x
    switchBtn.transform.y = c.y
    redealBtn.setSize(halfW, rowH)
    redealBtn.transform.x = c.x + halfW + gap
    redealBtn.transform.y = c.y
    flipBtn.setSize(c.width, rowH)
    flipBtn.transform.x = c.x
    flipBtn.transform.y = c.y + rowH + gap
  }

  /** Whether the player to move could take this candidate at all. */
  function isPickable(floor: Floor, slot: Slot): boolean {
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
  // the engine's DraggableBehavior; this wires the game's targets and commit.
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
          void commitHuman(slot, seat).catch(ignoreAbort)
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
      const rect = cellRectFor(side, pos.r, pos.c, win)
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

  const approvalSpent = (): boolean => approvalTaken || pendingApproval !== null

  function onSwitch(): void {
    if (!controlsActive()) return
    if (pendingApproval) {
      undoApproval(match, pendingApproval)
      pendingApproval = null
      sync()
      return
    }
    if (match.sides[match.turn].approvals <= 0 || approvalTaken) return
    pendingApproval = applyApproval(match, 'moveMarker')
    sync()
  }

  function onRedeal(): void {
    if (!controlsActive() || approvalSpent()) return
    if (match.sides[match.turn].approvals <= 0) return
    applyApproval(match, 'refreshFloor')
    approvalTaken = true
    sync()
  }

  function onFlip(): void {
    if (!controlsActive()) return
    flipMode = !flipMode
    sync()
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

  function promptChoice(card: Card, options: Effect[][]): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (scope.signal.aborted) {
        reject(abortError())
        return
      }
      const onAbort = (): void => {
        pendingChoice = null
        events.emit('choice', null)
        reject(abortError())
      }
      scope.signal.addEventListener('abort', onAbort, { once: true })
      pendingChoice = (index): void => {
        scope.signal.removeEventListener('abort', onAbort)
        pendingChoice = null
        events.emit('choice', null)
        resolve(index)
      }
      events.emit('choice', {
        card,
        options: options.map(describeOptionSpans),
        pick: (index) => pendingChoice?.(index),
      })
    })
  }

  async function commitHuman(slot: Slot, at: Pos): Promise<void> {
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
        if (isAbortError(e)) return
        throw e
      }
      // A swipe-out or a new match could have landed while the prompt was open.
      if (state !== 'playing') return
    }

    const wantPicks = take === 'hire' ? picks : []
    const candidates = legalHires(match).filter(
      (h) =>
        h.take === take &&
        h.slot === slot &&
        h.at.r === at.r &&
        h.at.c === at.c &&
        picksEqual(h.picks, wantPicks),
    )
    // Discards are deterministic: take the last filled candidate on the other
    // floor, which is the highest dropSlot the enumeration offers.
    const hire = candidates.reduce<Hire | null>(
      (best, h) =>
        best === null || (h.dropSlot ?? -1) > (best.dropSlot ?? -1) ? h : best,
      null,
    )
    if (!hire) {
      sync()
      return
    }

    if (!approvalSpent()) applyApproval(match, 'none')
    applyHire(match, hire)
    sync()
    await afterTurn()
  }

  /** Reset the per-turn control state for the side now to move. */
  function resetTurnControls(): void {
    pendingApproval = null
    approvalTaken = false
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

  async function runComputerTurn(signal: AbortSignal): Promise<void> {
    if (mode.kind !== 'ai') return
    events.emit('turnChanged', { turn: match.turn, thinking: true })
    await engine.wait(ANIM.aiThinkDelay, signal)

    // The search is synchronous, so it is sliced with a frame awaited between
    // slices. The abort check goes after the search: an aborted `wait` rejects,
    // so nothing downstream runs, but a swipe-out during the search must not
    // commit a move.
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
      if (e.pointer.capturedBy) return
      if (selected === null) return
      const seat = seatAt(match.turn, e.pointer.world.x, e.pointer.world.y)
      if (seat) void commitHuman(selected, seat).catch(ignoreAbort)
    },
    onReject: (e) => {
      if (e.pointer.capturedBy) return
      if (state === 'playing' && !paused) return
      selected = null
    },
  })

  function layout(next: Rect): void {
    table = computeTable(next)
    slots = [
      shortlistSlots(table.shortlist[0]),
      shortlistSlots(table.shortlist[1]),
    ]
    backdrop.setRect(next)
    if (state !== 'idle') sync()
  }

  function teardownCards(): void {
    for (const map of orgCards) {
      for (const node of map.values()) node.destroy()
      map.clear()
    }
    for (const node of candidateCards.values()) node.destroy()
    candidateCards.clear()
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
      selected = null
      resetTurnControls()
      state = 'playing'
      paused = false
      teardownCards()
      setUiVisible(true)
      sync()
      events.emit('matchStarted', { mode: next })
      events.emit('turnChanged', { turn: match.turn, thinking: false })
      if (!humanControls(next, match.turn)) {
        void runComputerTurn(scope.signal).catch(ignoreAbort)
      }
    },
    reset() {
      scope.reset()
      state = 'idle'
      paused = false
      selected = null
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
    resize(next) {
      layout(next)
    },
    destroy() {
      scope.dispose()
      gesture()
      root.destroy()
    },
  }

  setUiVisible(false)
  return session
}
