<!--
  Flood It's root component: builds the scene for the chosen mode, wires the
  session events to the canvas nodes and the DOM overlays, and tears the whole
  subtree down on unmount.

  The split follows the rest of the arcade. Everything under `game/` is pure or
  engine-only and knows nothing about Svelte; this file owns the mode choice, the
  overlays, and the layout of the scene nodes inside the region rect.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import {
    AbortScope,
    domAnchor,
    ignoreAbort,
    Node2D,
    type Rect,
  } from '@src/stargazer'
  import { coverView, REGION_HEIGHT, REGION_WIDTH } from '../../world'
  import { GradientBackgroundNode } from '../common/GradientBackgroundNode'
  import { seededRandom } from '../common/rng'
  import type { GameProps } from '../GameModule'
  import {
    ACCENT,
    ANIM,
    BoardNode,
    ChromeButtonNode,
    COLORS,
    computeFieldGeom,
    computeRaceSlots,
    computeSoloSlot,
    computeTerritorySlots,
    MoveMeterNode,
    NoticeNode,
    PuzzleSession,
    RaceMatch,
    sideMargins,
    SwatchBarNode,
    TallyNode,
    TerritorySession,
    type Bounds,
    type GameMode,
    type PlayerId,
    type RegionStyle,
    type Slot,
    type TerritoryEnding,
  } from './game'
  import { recordArcadeGame } from '../../game-log'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import { FLOOD_IT_TUTORIAL } from './tutorial'
  import { buildFloodItMenuPreview } from './game/menuPreview'
  import { FLOOD_IT_STRINGS as t } from './strings'
  import PauseMenu from '@src/displays/arcade/menu/PauseMenu.svelte'
  import ResultCard from './overlays/ResultCard.svelte'
  import SplashScreen from './overlays/SplashScreen.svelte'

  const { host, onExit, demoStage, region }: GameProps = $props()

  let screen = $state<'splash' | 'game'>('splash')
  let paused = $state(false)
  let showTutorial = $state(false)
  /**
   * Shape overlay, held here rather than persisted: a visitor who needs it
   * needs it for their whole session, and the booth deliberately remembers
   * nothing about the last visitor.
   */
  let glyphs = $state(false)

  /**
   * Rounds each player has taken in the versus mode being played, and whose
   * tally moved last. Shown on the menu between rounds.
   *
   * Deliberately not persisted: it belongs to the two people standing at the
   * booth, and starts over for the next pair. Switching versus mode resets it,
   * since a race win and a contest win are not the same thing to count
   * together.
   */
  let versus = $state<{
    kind: 'race' | 'territory'
    a: number
    b: number
    bump: PlayerId | null
  } | null>(null)

  /** What the result card shows. Null while a board is live. */
  let result = $state<{
    title: string
    titleColor?: string
    body?: string
    rows?: { label: string; value: string; color: string }[]
  } | null>(null)

  // --- Non-reactive runtime state. Everything below drives canvas nodes
  // directly, so plain fields and imperative updates stand in for the reactive
  // chains a DOM tree would need.

  /** The scene built for the active mode, or null on the menu. */
  type Rig =
    | {
        kind: 'solo'
        session: PuzzleSession
        board: BoardNode
        bar: SwatchBarNode
        meter: MoveMeterNode
      }
    | {
        kind: 'race'
        match: RaceMatch
        boards: BoardNode[]
        bars: SwatchBarNode[]
        meters: MoveMeterNode[]
        notices: NoticeNode[]
      }
    | {
        kind: 'territory'
        session: TerritorySession
        board: BoardNode
        bars: SwatchBarNode[]
        tallies: TallyNode[]
      }

  let mode: GameMode | null = null
  let rig: Rig | null = null
  let startedAtMs = 0

  const anchor = $derived(region.anchor)
  const gameRect = $derived(region.rect)
  /**
   * World depth of the booth's top-corner gesture boxes. The two chrome buttons
   * live in the top right, which is one of them.
   */
  const cornerInset = $derived(region.cornerInset)

  let contentLayer: Node2D | null = null
  let pauseButton: ChromeButtonNode | null = null
  let glyphButton: ChromeButtonNode | null = null
  /** Holds the end-of-board beat, so a torn-down board cannot open a card. */
  const holds = new AbortScope()

  /**
   * Region outline styles. Player two is dashed, so the two read apart even for
   * someone who cannot separate the accents.
   */
  const REGION_STYLES: Record<number, RegionStyle> = {
    1: { color: ACCENT[1], dashed: false },
    2: { color: ACCENT[2], dashed: true },
  }
  /** Solo has one region, so it needs no second style and no dashes. */
  const SOLO_STYLES: Record<number, RegionStyle> = {
    1: { color: COLORS.paper, dashed: false },
  }

  const bounds = (r: Rect): Bounds => ({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  })

  /**
   * Cover rect for the menu preview: the whole visible area at the fixed region
   * aspect, left-anchored, so the preview reads as a full background with no
   * borders at any aspect.
   */
  function previewView(): Rect {
    return coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)
  }

  // Stylized in-engine menu preview, up only while the splash is shown.
  // Reading `gameRect` rebuilds it when the window resizes.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildFloodItMenuPreview(host, previewView(), gameRect)
    return () => preview.destroy()
  })

  // --- Building a mode ----------------------------------------------------

  function start(next: GameMode): void {
    teardown()
    mode = next
    startedAtMs = performance.now()
    result = null
    screen = 'game'
    const random = seededRandom((Math.random() * 0xffffffff) >>> 0)

    if (next.kind === 'solo') rig = buildSolo(next, random)
    else if (next.kind === 'race') rig = buildRace(next, random)
    else rig = buildTerritory(next, random)

    layout()
    if (pauseButton) pauseButton.visible = true
    if (glyphButton) glyphButton.visible = true
    applyGlyphs()
  }

  function buildSolo(m: GameMode, random: () => number): Rig {
    const session = new PuzzleSession({ host, preset: m.preset, random })
    const board = new BoardNode(
      fieldFor(session.board, computeSoloSlot(bounds(gameRect)).board),
      session.board,
      [1],
      SOLO_STYLES,
      (c) => session.play(c),
    )
    const bar = new SwatchBarNode(session.board.numColors, (c) =>
      session.play(c),
    )
    const meter = new MoveMeterNode()
    contentLayer?.add(board, bar, meter)

    session.events.on('moved', (e) => {
      board.applyWave(e.result)
      meter.set(e.movesUsed, session.maxMoves)
    })
    session.events.on('stateChanged', () => {
      bar.setActive(session.state === 'playing')
    })
    session.events.on('finished', (e) => {
      if (e.outcome === 'flooded') board.celebrate()
      else board.setDimmed(true)
      logRound(m, [Math.max(0, session.maxMoves - session.movesUsed)])
      void openCard(() => {
        result =
          e.outcome === 'flooded'
            ? {
                title: t.wonTitle,
                titleColor: ACCENT[1],
                body: t.wonBody(e.movesUsed, session.par),
              }
            : {
                title: t.lostTitle,
                titleColor: ACCENT[2],
                body: t.lostBody(session.owned, session.total),
              }
      })
    })

    meter.set(0, session.maxMoves)
    session.start()
    return { kind: 'solo', session, board, bar, meter }
  }

  function buildRace(m: GameMode, random: () => number): Rig {
    const match = new RaceMatch(host, m.preset, random)
    const slots = computeRaceSlots(bounds(gameRect))
    const players: PlayerId[] = [1, 2]
    const boards: BoardNode[] = []
    const bars: SwatchBarNode[] = []
    const meters: MoveMeterNode[] = []
    const notices: NoticeNode[] = []

    for (const player of players) {
      const session = match.session(player)
      const slot = player === 1 ? slots.a : slots.b
      const board = new BoardNode(
        fieldFor(session.board, slot.board),
        session.board,
        [1],
        { 1: REGION_STYLES[player]! },
        (c) => session.play(c),
      )
      const bar = new SwatchBarNode(session.board.numColors, (c) =>
        session.play(c),
      )
      const meter = new MoveMeterNode()
      const notice = new NoticeNode()
      contentLayer?.add(board, bar, meter, notice)
      boards.push(board)
      bars.push(bar)
      meters.push(meter)
      notices.push(notice)

      session.events.on('moved', (e) => {
        board.applyWave(e.result)
        meter.set(e.movesUsed, session.maxMoves)
      })
      session.events.on('stateChanged', () => {
        bar.setActive(session.state === 'playing')
      })
      session.events.on('finished', (e) => {
        if (e.outcome === 'flooded') board.celebrate()
        else board.setDimmed(true)
        // The other player is still working, so say so rather than leaving a
        // frozen board with no explanation.
        if (!match.over) notice.show(t.waiting)
      })
      meter.set(0, session.maxMoves)
    }

    match.events.on('matchOver', (e) => {
      for (const notice of notices) notice.hide()
      tallyVersus('race', e.winner)
      logRound(
        m,
        [movesSaved(e.a, match.a.maxMoves), movesSaved(e.b, match.b.maxMoves)],
        e.winner,
      )
      const rows = [
        {
          label: t.playerOne,
          value:
            e.a.outcome === 'flooded'
              ? t.raceMoves(e.a.movesUsed)
              : t.raceUnfinished,
          color: ACCENT[1],
        },
        {
          label: t.playerTwo,
          value:
            e.b.outcome === 'flooded'
              ? t.raceMoves(e.b.movesUsed)
              : t.raceUnfinished,
          color: ACCENT[2],
        },
      ]
      void openCard(() => {
        result =
          e.winner === 0
            ? { title: t.raceTie, rows }
            : {
                title: t.raceWin(e.winner === 1 ? t.playerOne : t.playerTwo),
                titleColor: ACCENT[e.winner],
                rows,
              }
      })
    })

    match.start()
    return { kind: 'race', match, boards, bars, meters, notices }
  }

  function buildTerritory(m: GameMode, random: () => number): Rig {
    const session = new TerritorySession({ host, preset: m.preset, random })
    const slots = computeTerritorySlots(bounds(gameRect))
    const board = new BoardNode(
      fieldFor(session.board, slots.board),
      session.board,
      [1, 2],
      REGION_STYLES,
      // Turn-based, so a tap belongs to whoever is up. `play` rejects it if the
      // board is settling or over.
      (c) => session.play(session.turn, c),
    )
    const players: PlayerId[] = [1, 2]
    const bars = players.map(
      (player) =>
        new SwatchBarNode(session.board.numColors, (c) =>
          session.play(player, c),
        ),
    )
    const tallies = [
      new TallyNode(1, t.playerOne),
      new TallyNode(2, t.playerTwo),
    ]
    contentLayer?.add(board, ...bars, ...tallies)

    const syncTurn = (): void => {
      bars.forEach((bar, i) =>
        bar.setActive(session.canPlay((i + 1) as PlayerId)),
      )
      tallies.forEach((tally, i) =>
        tally.setActive(session.state === 'playing' && session.turn === i + 1),
      )
    }

    session.events.on('moved', (e) => board.applyWave(e.result))
    session.events.on('counts', (e) => {
      tallies[0]?.set(e.a)
      tallies[1]?.set(e.b)
    })
    session.events.on('stateChanged', syncTurn)
    session.events.on('turnChanged', syncTurn)
    session.events.on('matchOver', (e) => {
      syncTurn()
      tallyVersus('territory', e.winner)
      logRound(m, [e.a, e.b], e.winner)
      const rows = [
        { label: t.playerOne, value: t.territoryCells(e.a), color: ACCENT[1] },
        { label: t.playerTwo, value: t.territoryCells(e.b), color: ACCENT[2] },
      ]
      void openCard(() => {
        result =
          e.winner === 0
            ? { title: t.territoryTie, body: endingNote(e.ending), rows }
            : {
                title: t.territoryWin(
                  e.winner === 1 ? t.playerOne : t.playerTwo,
                ),
                titleColor: ACCENT[e.winner],
                body: endingNote(e.ending),
                rows,
              }
      })
    })

    session.start()
    syncTurn()
    return { kind: 'territory', session, board, bars, tallies }
  }

  const endingNote = (ending: TerritoryEnding): string =>
    ending === 'walledIn' ? t.walledIn : t.boardFull

  function fieldFor(board: { cols: number; rows: number }, rect: Bounds) {
    return computeFieldGeom(rect, board.cols, board.rows)
  }

  /** Hold on the settled board before the card opens, so the win is seen. */
  async function openCard(show: () => void): Promise<void> {
    const signal = holds.reset()
    await host.engine.wait(ANIM.resultHold, signal).catch(ignoreAbort)
    if (signal.aborted) return
    show()
  }

  // --- Layout ------------------------------------------------------------

  function layout(): void {
    const active = rig
    if (!active) return
    const region = bounds(gameRect)

    if (active.kind === 'solo') {
      const slot = computeSoloSlot(region)
      active.board.setGeom(fieldFor(active.session.board, slot.board))
      active.bar.setRect(slot.swatches)
      placeMeter(active.meter, slot)
      return
    }

    if (active.kind === 'race') {
      const slots = computeRaceSlots(region)
      const halves = [slots.a, slots.b]
      halves.forEach((slot, i) => {
        const session = active.match.session((i + 1) as PlayerId)
        active.boards[i]?.setGeom(fieldFor(session.board, slot.board))
        active.bars[i]?.setRect(slot.swatches)
        const meter = active.meters[i]
        if (meter) placeMeter(meter, slot)
        const notice = active.notices[i]
        if (notice) {
          notice.setSize(slot.swatches.height * 0.55)
          notice.transform.x = slot.board.x + slot.board.width / 2
          notice.transform.y = slot.board.y + slot.board.height / 2
        }
      })
      return
    }

    const slots = computeTerritorySlots(region)
    active.board.setGeom(fieldFor(active.session.board, slots.board))
    active.bars[0]?.setRect(slots.swatchesA)
    active.bars[1]?.setRect(slots.swatchesB)
    // One tally in each strip beside the shared board, centred against it, so
    // neither reads as belonging to the other player's half.
    const margins = sideMargins(region, slots.board)
    const midY = slots.board.y + slots.board.height / 2
    // Capped against the board, not just the strip: on a wide screen the strips
    // are half the region and a tally scaled to them would dwarf the board.
    const size = Math.min(
      Math.min(margins.left.width, margins.right.width) * 0.42,
      slots.board.height * 0.14,
    )
    active.tallies.forEach((tally, i) => {
      const strip = i === 0 ? margins.left : margins.right
      tally.setSize(size)
      tally.transform.x = strip.x + strip.width / 2
      tally.transform.y = midY
    })
  }

  /**
   * Centre a move counter in the band the layout reserved for it.
   *
   * Sized against the band rather than the board, so the number plus its
   * caption always fit inside it instead of running off the top of the region.
   */
  function placeMeter(meter: MoveMeterNode, slot: Slot): void {
    meter.setSize(slot.hud.height * 0.62)
    meter.transform.x = slot.hud.x + slot.hud.width / 2
    meter.transform.y = slot.hud.y + slot.hud.height * 0.45
  }

  /**
   * Both chrome buttons, in a row against the top right.
   *
   * The row is inset from the right edge far enough to clear the booth's corner
   * gesture, which swallows taps in the corner outright. Going sideways rather
   * than down keeps the buttons in the top band: the space below is the
   * board's, and on the large preset it reaches most of the way across.
   */
  function layoutChrome(): void {
    const size = Math.min(gameRect.width, gameRect.height) * 0.06
    const pad = size * 0.5
    const right = gameRect.x + gameRect.width - Math.max(pad, cornerInset)
    if (pauseButton) {
      pauseButton.setSize(size)
      pauseButton.transform.x = right - size
      pauseButton.transform.y = gameRect.y + pad
    }
    if (glyphButton) {
      glyphButton.setSize(size)
      glyphButton.transform.x = right - size * 2 - pad * 0.6
      glyphButton.transform.y = gameRect.y + pad
    }
  }

  function applyGlyphs(): void {
    glyphButton?.setOn(glyphs)
    if (!rig) return
    if (rig.kind === 'solo') {
      rig.board.setGlyphs(glyphs)
      rig.bar.setGlyphs(glyphs)
      return
    }
    if (rig.kind === 'race') {
      for (const board of rig.boards) board.setGlyphs(glyphs)
      for (const bar of rig.bars) bar.setGlyphs(glyphs)
      return
    }
    rig.board.setGlyphs(glyphs)
    for (const bar of rig.bars) bar.setGlyphs(glyphs)
  }

  // --- Flow --------------------------------------------------------------

  function pause(): void {
    if (screen !== 'game' || result) return
    host.engine.setPaused(true)
    paused = true
  }

  function resume(): void {
    host.engine.setPaused(false)
    paused = false
  }

  /** Credit a finished versus round to its winner. A tie counts for neither. */
  function tallyVersus(kind: 'race' | 'territory', winner: 0 | PlayerId): void {
    const current =
      versus?.kind === kind ? versus : { kind, a: 0, b: 0, bump: null }
    versus = {
      kind,
      a: current.a + (winner === 1 ? 1 : 0),
      b: current.b + (winner === 2 ? 1 : 0),
      bump: winner === 0 ? null : winner,
    }
  }

  function playAgain(): void {
    if (!mode) return
    start(mode)
  }

  function toSplash(): void {
    host.engine.setPaused(false)
    paused = false
    teardown()
    screen = 'splash'
  }

  function teardown(): void {
    holds.abort()
    result = null
    if (rig?.kind === 'solo') rig.session.destroy()
    else if (rig?.kind === 'race') rig.match.destroy()
    else if (rig?.kind === 'territory') rig.session.destroy()
    rig = null
    mode = null
    // The nodes are children of `contentLayer`, so one call drops the whole
    // per-board subtree without touching the backdrop or the chrome.
    contentLayer?.destroyChildren()
    if (pauseButton) pauseButton.visible = false
    if (glyphButton) glyphButton.visible = false
  }

  // --- Game log ----------------------------------------------------------

  /**
   * Record a finished round: one entry per player, all three modes.
   *
   * Scores are "higher is better" so the attendant panel ranks them the way it
   * ranks every other game: moves saved for the puzzle modes, cells held for
   * the contest. `winner` is left off a solo round, which is what marks it as
   * one.
   */
  function logRound(
    m: GameMode,
    scores: readonly number[],
    winner?: 0 | PlayerId,
  ): void {
    const base = {
      gameId: 'flood-it',
      mode: `${m.kind}:${m.preset}`,
      durationMs: Math.round(performance.now() - startedAtMs),
      ...(winner === undefined
        ? {}
        : { winner: winner === 0 ? 'tie' : `player${winner}` }),
    }
    for (const score of scores) {
      recordArcadeGame({ ...base, score }).catch((e: unknown) => {
        console.warn('[flood-it] failed to record game to server', e)
      })
    }
  }

  /** Moves a player had left over, or none if they never finished the board. */
  const movesSaved = (
    result: { outcome: string; movesUsed: number },
    maxMoves: number,
  ): number =>
    result.outcome === 'flooded' ? Math.max(0, maxMoves - result.movesUsed) : 0

  // --- Mount -------------------------------------------------------------

  onMount(() => {
    const view = region.rect

    // The backdrop gets its own layer, NOT the per-board content layer, because
    // `teardown` empties that one wholesale. A backdrop parented there would be
    // destroyed by the first `start()` and never come back.
    const backdrop = new Node2D('flood-it-backdrop')
    host.engine.tree.root.add(backdrop)
    const bg = new GradientBackgroundNode({
      rect: view,
      topLeft: COLORS.backdropTop,
      bottomRight: COLORS.backdropBottom,
    })
    backdrop.add(bg)

    const content = new Node2D('flood-it-content')
    host.engine.tree.root.add(content)
    contentLayer = content

    // Chrome sits above the board content whatever order boards are built in.
    const chrome = new Node2D('flood-it-chrome')
    host.engine.tree.root.add(chrome)

    const pauseBtn = new ChromeButtonNode('pause', pause)
    pauseBtn.visible = false
    const glyphBtn = new ChromeButtonNode('glyphs', () => {
      glyphs = !glyphs
      applyGlyphs()
    })
    glyphBtn.visible = false
    chrome.add(pauseBtn, glyphBtn)
    pauseButton = pauseBtn
    glyphButton = glyphBtn
    layoutChrome()

    const offResize = region.onResize((v) => {
      bg.setRect(v)
      layoutChrome()
      layout()
    })

    return () => {
      offResize()
      holds.dispose()
      teardown()
      if (!backdrop.isDestroyed) backdrop.destroy()
      if (!content.isDestroyed) content.destroy()
      if (!chrome.isDestroyed) chrome.destroy()
      contentLayer = null
      pauseButton = null
      glyphButton = null
    }
  })
</script>

<div class="fl">
  {#if anchor}
    <div
      class="fl__ui"
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
          versusWins={versus ? { a: versus.a, b: versus.b } : undefined}
          bumpPlayer={versus?.bump ?? null}
        />
      {/if}

      {#if result}
        <ResultCard
          title={result.title}
          titleColor={result.titleColor}
          body={result.body}
          onPlayAgain={playAgain}
          onMenu={toSplash}
        >
          {#snippet detail()}
            {#if result?.rows}
              <div class="fl__rows">
                {#each result.rows as row (row.label)}
                  <div class="fl__row">
                    <span class="fl__row-label" style:color={row.color}
                      >{row.label}</span
                    >
                    <span class="fl__row-value">{row.value}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/snippet}
        </ResultCard>
      {/if}

      {#if paused}
        <PauseMenu onResume={resume} onQuit={toSplash} />
      {/if}
    </div>
  {/if}

  <!-- Screen-space tutorial (not camera-anchored, so its demo renders sharp). -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={FLOOD_IT_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}
</div>

<style lang="sass">
  .fl
    position: absolute
    inset: 0
    pointer-events: none
    font-family: var(--font-text)

  .fl__ui
    pointer-events: none

  .fl__rows
    display: flex
    flex-direction: column
    gap: var(--space-8)
    min-width: 16rem

  .fl__row
    display: flex
    align-items: baseline
    justify-content: space-between
    gap: var(--space-24)

  .fl__row-label
    @include tint.type-class(ui-bold)
    line-height: 1.4

  .fl__row-value
    @include tint.type-class(ui)
    line-height: 1.4
    color: var(--color-text-secondary)
</style>
