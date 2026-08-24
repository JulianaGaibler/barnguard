<!--
  Buffer Overflow's root component: builds the scene for the chosen mode, wires
  the session events to the canvas nodes and the DOM overlays, and tears the
  whole subtree down on unmount.

  The split follows the rest of the arcade. Everything under `game/` is pure or
  engine-only and knows nothing about Svelte; this file owns the mode choice,
  the overlays, and the placement of the scene nodes inside the region rect.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { domAnchor, Node2D, Vignette, type Rect } from '@src/stargazer'
  import { coverView, REGION_HEIGHT, REGION_WIDTH } from '../../world'
  import { GradientBackgroundNode } from '../common/GradientBackgroundNode'
  import { randomSeed } from '../common/rng'
  import { createScreenPulse, type ScreenPulse } from '../common/screenPulse'
  import { recordArcadeGame } from '../../game-log'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import LeaderboardModal from '../../leaderboard/LeaderboardModal.svelte'
  import type { GameProps } from '../GameModule'
  import {
    accentForLevel,
    ACCENT_VS,
    AddressGutterNode,
    ANIM,
    BannerNode,
    bindBufferGestures,
    BufferNode,
    ClearBurstNode,
    ClockNode,
    COLS,
    computeLayout,
    ControlClusterNode,
    DAS,
    EventLogNode,
    FLUSH_LINES,
    GraphPaneNode,
    GRADIENT,
    HeaderBarNode,
    HoldButtonNode,
    HoldPanelNode,
    LINES_PER_LEVEL,
    Match,
    NextQueueNode,
    PaneNode,
    PauseCapNode,
    PieceLayerNode,
    pieceCells,
    ScanlineNode,
    Session,
    StatBadgeNode,
    StatusBarNode,
    TelemetryPaneNode,
    VISIBLE_ROWS,
    VISIBLE_TOP,
    type Action,
    type Bounds,
    type Chrome,
    type GameMode,
    type Layout,
    type PlayerId,
    type SeatGeometry,
  } from './game'
  import { BUFFER_OVERFLOW_LEADERBOARDS } from './leaderboards'
  import { BUFFER_OVERFLOW_STRINGS as t } from './strings'
  import { BUFFER_OVERFLOW_TUTORIAL } from './tutorial'
  import { buildBufferOverflowMenuPreview } from './game/menuPreview'
  import GameOver from './overlays/GameOver.svelte'
  import GameOverVersus from './overlays/GameOverVersus.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import SplashScreen from './overlays/SplashScreen.svelte'

  const { host, onExit, demoStage, region }: GameProps = $props()

  let screen = $state<'splash' | 'game'>('splash')
  let paused = $state(false)
  let showTutorial = $state(false)
  let showLeaderboard = $state(false)

  /** The solo result card, or null while a run is live. */
  let soloResult = $state<{
    reason: 'overflow' | 'timeUp'
    score: number
    lines: number
    level: number
  } | null>(null)

  /** The versus result card. */
  let versusResult = $state<{
    winner: 0 | PlayerId
    scoreA: number
    scoreB: number
  } | null>(null)

  /**
   * Rounds each seat has taken in the mode being played, shown on the menu.
   *
   * Held here rather than persisted: it belongs to the two people standing at
   * the booth, and starts over for the next pair. Switching mode resets it,
   * since an Uptime win and a Countdown win are not the same thing to count
   * together.
   */
  let versusWins = $state<{
    kind: GameMode['kind']
    a: number
    b: number
    bump: PlayerId | null
  } | null>(null)

  // --- Non-reactive runtime state. Everything below drives canvas nodes
  // directly, so plain fields and imperative updates stand in for the reactive
  // chains a DOM tree would need.

  /** One seat's nodes, all placed from a single `SeatGeometry`. */
  interface Seat {
    session: Session
    geom: SeatGeometry
    statePane: PaneNode
    statsPane: PaneNode
    inputPane: PaneNode
    /** Ambient windows, solo only: two stacked left, one graph right. */
    asides: Node2D[]
    buffer: BufferNode
    gutter: AddressGutterNode
    pieces: PieceLayerNode
    hold: HoldPanelNode
    holdButton: HoldButtonNode
    log: EventLogNode
    next: NextQueueNode
    score: StatBadgeNode
    level: StatBadgeNode
    lines: StatBadgeNode
    clock: ClockNode | null
    controls: ControlClusterNode
    banner: BannerNode
    burst: ClearBurstNode
    unbindGestures: () => void
  }

  type Rig =
    | { kind: 'solo'; seat: Seat }
    | { kind: 'versus'; match: Match; seats: [Seat, Seat] }

  /** Reactive: the result cards key on it to pick their board. */
  let mode = $state<GameMode | null>(null)
  let rig: Rig | null = null
  let startedAtMs = 0
  let pendingLog: { mode: string; durationMs: number } | null = null

  // All of it from the shell, which computes it once for every game rather
  // than each repeating the arithmetic and the anchor bookkeeping.
  const anchor = $derived(region.anchor)
  const gameRect = $derived(region.rect)
  /** World depth of the booth's corner gesture boxes, kept current on resize. */
  const cornerInset = $derived(region.cornerInset)

  let contentLayer: Node2D | null = null
  let pauseButton: PauseCapNode | null = null
  let headerBar: HeaderBarNode | null = null
  let statusBar: StatusBarNode | null = null
  let screenPulse: ScreenPulse | null = null
  /** The last resolved layout, so a repaint does not recompute the window. */
  let placed: Layout | null = null
  /** Pieces locked this run, for the status line. */
  let pieceCount = 0
  /** The run's seed, which the status line reports so a board can be retold. */
  let seed = 0

  const bounds = (r: Rect): Bounds => ({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  })

  /**
   * Cover rect for the menu preview: the whole visible area at the fixed region
   * aspect, left-anchored, so it reads as a full background at any aspect.
   */
  const previewView = (): Rect =>
    coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)

  // Stylized in-engine menu preview, up only while the splash is shown.
  // Reading `gameRect` rebuilds it when the window resizes.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildBufferOverflowMenuPreview(
      host,
      previewView(),
      gameRect,
    )
    return () => preview.destroy()
  })

  // --- Building a seat ----------------------------------------------------

  function buildSeat(
    session: Session,
    geom: SeatGeometry,
    chrome: Chrome,
    who: PlayerId | null,
  ): Seat {
    const statePane = new PaneNode(t.paneState)
    const statsPane = new PaneNode(t.paneStats)
    // The controls sit inside a frame of their own, which is what closes the
    // bottom of the window and stops the board reading as furniture arranged on
    // a background.
    const inputPane = new PaneNode(t.paneInput)
    // Solo only. A race has no width to spare and two of these would be four
    // columns of decoration around two boards.
    const asides: Node2D[] =
      geom.asideLeftTop.width > 0
        ? [
            new TelemetryPaneNode({
              title: t.paneSys,
              header: t.sysHeader,
              gauges: t.sysGauges,
              seed: seed ^ 0x5a,
            }),
            new TelemetryPaneNode({
              title: t.paneBuild,
              header: t.buildHeader,
              gauges: [],
              job: true,
              seed: seed ^ 0xa5,
            }),
            new GraphPaneNode({
              title: t.paneLoad,
              columns: t.loadColumns,
              seed: seed ^ 0x33,
            }),
          ]
        : []
    const buffer = new BufferNode()
    buffer.setBuffer(session.buffer)
    buffer.setTitle(
      who ? t.seat(who) : t.bufferPath,
      who ? '' : `${COLS}x${VISIBLE_ROWS}`,
      who ? ACCENT_VS[who] : undefined,
    )
    const gutter = new AddressGutterNode()
    const pieces = new PieceLayerNode()
    const log = new EventLogNode()
    const hold = new HoldPanelNode()
    const holdButton = new HoldButtonNode({
      label: t.bank,
      onPress: () => session.input('hold'),
      enabled: () => session.canHold && !paused,
    })
    const next = new NextQueueNode()
    const score = new StatBadgeNode({
      label: t.score,
      showGain: true,
      countUp: true,
    })
    const level = new StatBadgeNode({ label: t.level, meter: true })
    const lines = new StatBadgeNode({ label: t.lines })
    const clock = session.mode === 'countdown' ? new ClockNode() : null
    const banner = new BannerNode()
    const burst = new ClearBurstNode()
    const controls = new ControlClusterNode({
      onAction: (action: Action) => session.input(action),
      onSoftDrop: (held: boolean) => session.setSoftDrop(held),
      enabled: () => session.state === 'playing' && !paused,
    })

    hold.setCaption(t.hold)
    next.setCaption(t.next)
    log.setCaption(t.events)
    clock?.setCaption(t.time)

    // Paint order: the panes first, so every section draws inside its own
    // frame, then the buffer and the piece over it, then effects, then the
    // controls, which must never be swallowed by anything drawn later.
    contentLayer?.add(statePane, statsPane, inputPane, ...asides)
    contentLayer?.add(buffer, gutter, pieces, burst, banner)
    contentLayer?.add(hold, holdButton, log, next, score, level, lines)
    contentLayer?.add(controls)
    if (clock) contentLayer?.add(clock)

    const unbindGestures = bindBufferGestures(host.engine, {
      geom: () => seat.geom,
      enabled: () => session.state === 'playing' && !paused,
      onAction: (action) => session.input(action),
      onSoftDrop: (held) => session.setSoftDrop(held),
      onDragStart: () => session.beginDrag(),
      onDragBy: (columns) => session.dragBy(columns),
      onDragEnd: () => session.endDrag(),
    })

    const seat: Seat = {
      session,
      geom,
      statePane,
      statsPane,
      inputPane,
      asides,
      buffer,
      gutter,
      pieces,
      hold,
      holdButton,
      log,
      next,
      score,
      level,
      lines,
      clock,
      controls,
      banner,
      burst,
      unbindGestures,
    }
    wireSeat(seat)
    placeSeat(seat, geom, chrome)
    return seat
  }

  /**
   * Which visible rows the falling piece would come to rest on.
   *
   * Feeds the address gutter, which brightens them. It is the ghost restated in
   * the margin, which is the one place a player looking at the stack rather
   * than at the piece will still catch it.
   */
  function ghostRows(session: Session): number[] {
    const ghost = session.ghost
    if (!ghost) return []
    // A plain array with a scan rather than a set: a piece is four cells, so
    // the scan is shorter than allocating anything to avoid it.
    const rows: number[] = []
    for (const c of pieceCells(ghost.kind, ghost.rot)) {
      const row = ghost.y + c.y - VISIBLE_TOP
      if (row >= 0 && !rows.includes(row)) rows.push(row)
    }
    return rows
  }

  /** Everything the session tells this seat's nodes. */
  function wireSeat(seat: Seat): void {
    const { session } = seat

    const syncPiece = (): void => {
      seat.pieces.setPiece(session.piece, session.ghost)
      seat.gutter.setMarked(ghostRows(session))
    }

    session.events.on('spawned', (e) => {
      syncPiece()
      seat.next.set(e.next)
      seat.hold.set(e.hold, false)
    })
    session.events.on('pieceMoved', syncPiece)
    session.events.on('held', (e) => {
      seat.hold.set(e.hold, true)
      seat.next.set(e.next)
      syncPiece()
    })
    session.events.on('locked', (e) => {
      syncPiece()
      pieceCount += 1
      refreshStatus()
      if (e.hardDropped) seat.pieces.impact()
    })
    session.events.on('score', (v) => seat.score.set(v))
    session.events.on('progress', (e) => {
      seat.lines.set(e.lines)
      seat.level.set(e.level)
      seat.level.setProgress(e.lines % LINES_PER_LEVEL, LINES_PER_LEVEL)
      seat.buffer.setLevel(e.level)
      seat.clock?.setLevel(e.level)
      seat.controls.setLevel(e.level)
      seat.holdButton.setLevel(e.level)
      seat.log.setLevel(e.level)
      seat.statePane.setLevel(e.level)
      seat.statsPane.setLevel(e.level)
      seat.inputPane.setLevel(e.level)
      for (const aside of seat.asides) {
        ;(aside as TelemetryPaneNode).setLevel(e.level)
      }
      headerBar?.setLevel(e.level)
      pauseButton?.setLevel(e.level)
      for (const badge of [seat.score, seat.level, seat.lines]) {
        badge.setLevel(e.level)
      }
      if (e.lines > 0 && e.lines % LINES_PER_LEVEL === 0) {
        seat.banner.show(t.levelUp(e.level), accentForLevel(e.level))
        seat.log.push(t.logLevel(e.level), 0, 'accent')
      }
    })
    session.events.on('clock', (v) => seat.clock?.setRemaining(v))
    session.events.on('clockExtended', (e) => {
      seat.clock?.granted(e.granted)
      if (e.granted > 0) seat.log.push(t.logTime(e.granted), 0, 'plain')
    })
    session.events.on('resolved', (e) => celebrate(seat, e))
    session.events.on('stateChanged', (state) => {
      if (state !== 'clearing') seat.buffer.clearFlash()
      seat.buffer.setDimmed(state === 'over')
    })
    session.events.on('over', (e) => {
      seat.banner.hide()
      seat.log.push(
        e.reason === 'timeUp' ? t.logTimeout : t.logOverflow,
        0,
        'warn',
      )
      syncPiece()
    })
  }

  /**
   * The reward for a lock: flash, sparks, a knock, and a word for the two that
   * are worth naming.
   */
  function celebrate(
    seat: Seat,
    e: {
      rows: number[]
      twist: string
      points: number
      combo: number
      level: number
    },
  ): void {
    if (e.rows.length === 0) return
    seat.buffer.flashRows(e.rows)
    seat.buffer.shake(e.rows.length)
    seat.burst.fire(seat.geom.buffer, seat.geom.cell, e.rows, VISIBLE_TOP)

    const accent = accentForLevel(e.level)
    const chain = e.combo > 1 ? t.combo(e.combo) : ''
    const flush = e.rows.length >= FLUSH_LINES
    const twist = e.twist !== 'none'
    if (flush) {
      seat.banner.show(t.flush, accent, chain)
      firePulse(1)
    } else if (twist) {
      seat.banner.show(t.twist, accent, chain)
      firePulse(0.7)
    } else if (chain) {
      seat.banner.show(chain, accent)
    }

    // One line per resolve, with the chain folded into the label rather than
    // taking a row of its own. A log that spends two rows on one action shows
    // half as much history in the same pane.
    const label = flush
      ? t.logFlush
      : twist
        ? t.logTwist(e.rows.length)
        : t.logClear(e.rows.length)
    seat.log.push(
      chain ? `${label} ${t.logChain(e.combo)}` : label,
      e.points,
      flush || twist ? 'accent' : 'plain',
    )
  }

  /**
   * The whole-screen fringe, reserved for a flush or a twist.
   *
   * In a race it fires for either seat, which is the point: those are the two
   * events worth looking up from your own buffer for. Anything smaller would
   * flash the screen at a player for something their opponent did, which
   * interrupts rather than shares.
   */
  function firePulse(strength: number): void {
    screenPulse?.fire(strength)
  }

  /** Snap every readout to the session with no accents, for a fresh run. */
  function resetStats(seat: Seat): void {
    seat.score.reset(seat.session.score)
    seat.level.reset(seat.session.level)
    seat.lines.reset(seat.session.lines)
  }

  function placeSeat(seat: Seat, geom: SeatGeometry, chrome: Chrome): void {
    seat.geom = geom
    seat.statePane.setRect(geom.statePane, geom.cell)
    seat.statsPane.setRect(geom.statsPane, geom.cell)
    seat.inputPane.setRect(geom.controls, geom.cell)
    const asideRects = [
      geom.asideLeftTop,
      geom.asideLeftBottom,
      geom.asideRight,
    ]
    seat.asides.forEach((aside, i) => {
      ;(aside as TelemetryPaneNode).setRect(asideRects[i], geom.cell)
    })
    // The panes rule between whichever sections survived, so a dropped section
    // takes its divider with it and there is no second list to keep in step.
    seat.statePane.setSections([
      geom.hold,
      geom.holdButton,
      geom.log,
      geom.clock,
    ])
    seat.statsPane.setSections([geom.next, geom.score, geom.level, geom.lines])

    seat.buffer.setRect(geom.buffer, geom.bufferFrame, geom.cell)
    seat.buffer.setTicks(chrome.ticks)
    seat.gutter.setRect(geom.gutter, geom.cell, VISIBLE_ROWS)
    seat.pieces.setRect(geom.buffer, geom.cell)
    seat.hold.setRect(geom.hold, geom.cell)
    seat.holdButton.setRect(geom.holdButton)
    seat.log.setRect(geom.log, geom.cell)
    seat.log.setRows(chrome.logLines)
    seat.next.setRect(geom.next, geom.cell)
    seat.next.setCount(chrome.queueCount)
    seat.score.setRect(geom.score, geom.cell)
    seat.level.setRect(geom.level, geom.cell)
    seat.lines.setRect(geom.lines, geom.cell)
    seat.clock?.setRect(geom.clock, geom.cell)
    seat.controls.setRect(geom.controlsBody)
    seat.banner.place(
      geom.buffer.x + geom.buffer.width / 2,
      geom.buffer.y + geom.buffer.height * 0.36,
      geom.cell,
    )
  }

  // --- Flow ---------------------------------------------------------------

  function start(next: GameMode): void {
    teardown()
    mode = next
    startedAtMs = performance.now()
    soloResult = null
    versusResult = null
    screen = 'game'
    seed = randomSeed()
    pieceCount = 0
    const l = resolveLayout(next.players, next.kind === 'countdown')
    placed = l

    if (next.players === 1) {
      const session = new Session({ host, mode: next.kind, seed })
      contentLayer?.add(session.root)
      const seat = buildSeat(session, l.seats[0], l.chrome, null)
      session.events.on('over', (e) => {
        logRound(next, [e.score])
        soloResult = {
          reason: e.reason,
          score: e.score,
          lines: e.lines,
          level: e.level,
        }
      })
      rig = { kind: 'solo', seat }
      session.start()
      resetStats(seat)
    } else {
      const match = new Match(host, next.kind, seed)
      contentLayer?.add(match.root)
      const seats: [Seat, Seat] = [
        buildSeat(match.a, l.seats[0], l.chrome, 1),
        buildSeat(match.b, l.seats[1], l.chrome, 2),
      ]
      match.events.on('playerOut', (e) => {
        // The survivor plays on, so tell the player who is out what they are
        // being chased by rather than leaving them a frozen buffer.
        const other = seats[e.player === 1 ? 1 : 0]
        const mine = seats[e.player === 1 ? 0 : 1]
        mine.banner.show(
          t.waiting,
          ACCENT_VS[e.player],
          t.opponentScore(other.session.score),
        )
      })
      match.events.on('matchOver', (e) => {
        tallyVersus(next.kind, e.winner)
        logRound(next, [e.a.score, e.b.score], e.winner)
        versusResult = {
          winner: e.winner,
          scoreA: e.a.score,
          scoreB: e.b.score,
        }
      })
      rig = { kind: 'versus', match, seats }
      match.start()
      for (const seat of seats) resetStats(seat)
    }

    if (pauseButton) pauseButton.visible = true
    if (statusBar) statusBar.visible = true
    if (headerBar) {
      headerBar.visible = true
      headerBar.reset()
      headerBar.setTitle(t.headerTitle)
    }
    layout()
  }

  /** One resolve of the whole window, then everything placed from it. */
  function resolveLayout(players: 1 | 2, clock: boolean): Layout {
    const size = Math.min(gameRect.width, gameRect.height) * 0.055
    return computeLayout({
      region: bounds(gameRect),
      players,
      cssPxInWorld: region.cssPxInWorld,
      clock,
      // What the header keeps clear on its right for the pause cap.
      rightInset: size * 1.5 + Math.max(size * 0.5, cornerInset),
    })
  }

  function layout(): void {
    if (!rig) return
    const seats = rig.kind === 'solo' ? [rig.seat] : rig.seats
    const l = resolveLayout(
      rig.kind === 'solo' ? 1 : 2,
      seats[0].clock !== null,
    )
    placed = l
    seats.forEach((seat, i) => placeSeat(seat, l.seats[i], l.chrome))
    headerBar?.setRect(l.header)
    headerBar?.setDetail(headerDetail(), l.chrome.headerDetail)
    statusBar?.setRect(l.status)
    refreshStatus()
    layoutChrome()
  }

  /** Mode and seat count, which the header shows after its title. */
  function headerDetail(): string[] {
    if (!mode) return []
    return [`mode: ${mode.kind}`, `players: ${mode.players}`]
  }

  /**
   * The status line, rebuilt from what the run knows.
   *
   * Most important first, because the ladder drops the tail. The seed goes
   * first: it is the only field a player could not work out by watching.
   */
  function refreshStatus(): void {
    if (!statusBar || !placed) return
    const seat = rig?.kind === 'solo' ? rig.seat : rig?.seats[0]
    const up = seat?.log.elapsed ?? 0
    const pps = up > 0 ? (pieceCount / up).toFixed(1) : '0.0'
    statusBar.setFields(
      [
        {
          label: 'seed',
          value: `0x${seed.toString(16).padStart(4, '0').slice(-4)}`,
        },
        { label: 'pieces', value: String(pieceCount) },
        { label: 'pps', value: pps },
        { label: 'das', value: `${Math.round(DAS.delay * 1000)}ms` },
      ],
      placed.chrome.statusFields,
    )
  }

  /**
   * The pause button, in the top right.
   *
   * Cleared from the booth's corner gesture DOWNWARD rather than sideways: the
   * flanking panels reach the top of the region here, so there is no room to
   * inset from the edge the way a game with a free top band would.
   */
  function layoutChrome(): void {
    if (!pauseButton) return
    const size = Math.min(gameRect.width, gameRect.height) * 0.055
    const pad = size * 0.5
    pauseButton.setRect({
      x: gameRect.x + gameRect.width - size - pad,
      y: gameRect.y + Math.max(pad, cornerInset),
      width: size,
      height: size,
    })
  }

  function pause(): void {
    if (screen !== 'game' || soloResult || versusResult) return
    host.engine.setPaused(true)
    paused = true
  }

  function resume(): void {
    host.engine.setPaused(false)
    paused = false
  }

  /** Credit a finished versus round to its winner. A tie counts for neither. */
  function tallyVersus(kind: GameMode['kind'], winner: 0 | PlayerId): void {
    const current =
      versusWins?.kind === kind ? versusWins : { kind, a: 0, b: 0, bump: null }
    versusWins = {
      kind,
      a: current.a + (winner === 1 ? 1 : 0),
      b: current.b + (winner === 2 ? 1 : 0),
      bump: winner === 0 ? null : winner,
    }
  }

  function playAgain(): void {
    if (mode) start(mode)
  }

  function toSplash(): void {
    host.engine.setPaused(false)
    paused = false
    teardown()
    screen = 'splash'
  }

  function teardown(): void {
    if (rig?.kind === 'solo') {
      rig.seat.unbindGestures()
      rig.seat.session.destroy()
    } else if (rig?.kind === 'versus') {
      for (const seat of rig.seats) seat.unbindGestures()
      rig.match.destroy()
    }
    rig = null
    mode = null
    soloResult = null
    versusResult = null
    pendingLog = null
    // The nodes are children of `contentLayer`, so one call drops the whole
    // per-run subtree without touching the backdrop or the chrome.
    contentLayer?.destroyChildren()
    if (pauseButton) pauseButton.visible = false
    if (headerBar) headerBar.visible = false
    if (statusBar) statusBar.visible = false
  }

  // --- Game log -----------------------------------------------------------

  /**
   * Record a finished run: one entry per seat.
   *
   * One `gameId` for both modes, with the mode carried in the free-form tag. A
   * second id would give per-mode high-score badges, but the manifest resolves
   * a record's game by that id and only the registered one exists, so
   * `wasGameHigh` is mode-blind here.
   *
   * The duration is frozen now rather than at finalize, because the player
   * lingers on the result card and that time is not play.
   */
  function logRound(
    m: GameMode,
    scores: readonly number[],
    winner?: 0 | PlayerId,
  ): void {
    const seats = m.players === 1 ? 'solo' : 'versus'
    pendingLog = {
      mode: `${m.kind}-${seats}`,
      durationMs: Math.round(performance.now() - startedAtMs),
    }
    pendingScores = [...scores]
    pendingWinner = winner
  }

  let pendingScores: number[] = []
  let pendingWinner: 0 | PlayerId | undefined

  /** Write the log once the player has either entered a name or skipped it. */
  function finalizeLog(names: string[]): void {
    const log = pendingLog
    if (!log) return
    pendingLog = null
    const base = {
      gameId: 'buffer-overflow',
      mode: log.mode,
      durationMs: log.durationMs,
      ...(pendingWinner === undefined
        ? {}
        : {
            winner: pendingWinner === 0 ? 'tie' : `player${pendingWinner}`,
          }),
    }
    pendingScores.forEach((score, i) => {
      recordArcadeGame({
        ...base,
        score,
        playerName: names[i] || undefined,
      }).catch((e: unknown) => {
        console.warn('[buffer-overflow] failed to record game to server', e)
      })
    })
  }

  // --- Mount --------------------------------------------------------------

  onMount(() => {
    const view = region.rect

    // The backdrop gets its own layer, NOT the per-run content layer, because
    // `teardown` empties that one wholesale. A backdrop parented there would be
    // destroyed by the first `start()` and never come back.
    const backdrop = new Node2D('buffer-overflow-backdrop')
    host.engine.tree.root.add(backdrop)
    const bg = new GradientBackgroundNode({
      rect: view,
      topLeft: GRADIENT.topLeft,
      bottomRight: GRADIENT.bottomRight,
    })
    backdrop.add(bg)

    const content = new Node2D('buffer-overflow-content')
    host.engine.tree.root.add(content)
    contentLayer = content

    // Chrome sits above the run content whatever order seats are built in.
    const chrome = new Node2D('buffer-overflow-chrome')
    host.engine.tree.root.add(chrome)

    const header = new HeaderBarNode()
    header.visible = false
    const status = new StatusBarNode()
    status.visible = false
    chrome.add(header, status)
    headerBar = header
    statusBar = status

    const pauseBtn = new PauseCapNode(pause)
    pauseBtn.visible = false
    chrome.add(pauseBtn)
    pauseButton = pauseBtn
    layoutChrome()

    // Last into the chrome layer, so the field lies over everything the canvas
    // draws rather than under the controls it is meant to cover.
    const scanlines = new ScanlineNode()
    scanlines.setRegion(bounds(view))
    chrome.add(scanlines)

    // Primed while the arcade is still panning in, so the first flush is a
    // flash rather than a stall.
    screenPulse = createScreenPulse(host, {
      durationSec: ANIM.pulseDuration,
      amount: ANIM.pulseAmount,
      // Never fully settles, so the screen reads as a live monitor rather than
      // as a flat panel. The post pass runs for the life of the game because of
      // it, which is the trade this look is worth.
      baseline: ANIM.pulseBaseline,
    })
    const vignette = new Vignette({
      intensity: 0.4,
      radius: 0.55,
      softness: 0.6,
    })
    host.engine.postProcess.add(vignette)

    const offResize = region.onResize((v) => {
      bg.setRect(v)
      scanlines.setRegion(bounds(v))
      layoutChrome()
      layout()
    })

    return () => {
      offResize()
      teardown()
      screenPulse?.destroy()
      screenPulse = null
      // Post-processing is engine-wide and the arcade never reloads, so an
      // effect left behind would follow the player into the next game.
      host.engine.postProcess.remove(vignette)
      headerBar = null
      statusBar = null
      placed = null
      if (!backdrop.isDestroyed) backdrop.destroy()
      if (!content.isDestroyed) content.destroy()
      if (!chrome.isDestroyed) chrome.destroy()
      // The anchor belongs to the shell's `GameRegion`, not to this game.
      contentLayer = null
      pauseButton = null
    }
  })
</script>

<div class="bo">
  {#if anchor}
    <div
      class="bo__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if screen === 'splash'}
        <SplashScreen
          onStart={start}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
          onOpenLeaderboard={() => (showLeaderboard = true)}
          versusWins={versusWins
            ? { a: versusWins.a, b: versusWins.b }
            : undefined}
          bumpPlayer={versusWins?.bump ?? null}
        />
      {/if}

      <!-- Keyed on the mode: the panel reads its board once on mount, so a
           mode change has to remount it rather than retarget it. -->
      {#if soloResult && mode}
        {#key mode.kind}
          <GameOver
            mode={mode.kind}
            reason={soloResult.reason}
            score={soloResult.score}
            lines={soloResult.lines}
            level={soloResult.level}
            onPlayAgain={playAgain}
            onMenu={toSplash}
            onFinalize={(name) => finalizeLog([name])}
          />
        {/key}
      {/if}

      {#if versusResult && mode}
        {#key mode.kind}
          <GameOverVersus
            mode={mode.kind}
            winner={versusResult.winner}
            scoreA={versusResult.scoreA}
            scoreB={versusResult.scoreB}
            onPlayAgain={playAgain}
            onMenu={toSplash}
            onFinalize={(names) => finalizeLog([names.a, names.b])}
          />
        {/key}
      {/if}

      {#if paused}
        <PauseMenu onResume={resume} onQuit={toSplash} />
      {/if}
    </div>
  {/if}

  <!-- Screen-space modals (not camera-anchored, so they render sharp). -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={BUFFER_OVERFLOW_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}

  {#if showLeaderboard}
    <LeaderboardModal
      boards={BUFFER_OVERFLOW_LEADERBOARDS}
      onClose={() => (showLeaderboard = false)}
    />
  {/if}
</div>

<style lang="sass">
  .bo
    position: absolute
    inset: 0
    pointer-events: none
    font-family: var(--font-text)

  .bo__ui
    pointer-events: none
    position: relative

  // The canvas draws a scanline field over itself, and the DOM overlays sit
  // above the canvas, so without this a modal would read as a clean panel
  // floating over a CRT. Scoped to this wrapper, so it cannot reach the
  // launcher during the pan.
  .bo__ui::after
    content: ''
    position: absolute
    inset: 0
    pointer-events: none
    z-index: 2
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.22) 0,
      rgba(0, 0, 0, 0.22) 1px,
      transparent 1px,
      transparent 3px
    )
</style>
