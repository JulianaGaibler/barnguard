<!--
  2048's root component. It owns the scene subtree for one or two boards, the
  overlays that sit over them, and the navigation between menu, play and result.

  Scene order is fixed and set up once: the gradient backdrop, then a content
  layer holding the boards and their HUD, then a chrome layer for the pause
  button. Painter order follows scene order, so the chrome stays above a board
  no matter when a session rebuilds itself.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { domAnchor, Node2D, type Rect } from '@src/stargazer'
  import { GradientBackgroundNode } from '../common/GradientBackgroundNode'
  import HowToPlay from '@src/displays/arcade/tutorial/HowToPlay.svelte'
  import LeaderboardModal from '@src/displays/arcade/leaderboard/LeaderboardModal.svelte'
  import { recordArcadeGame } from '@src/displays/arcade/game-log'
  import {
    boothCornerInset,
    coverView,
    gameVisibleRect,
    REGION_HEIGHT,
    REGION_WIDTH,
  } from '@src/displays/arcade/world'
  import type { GameProps } from '../GameModule'
  import {
    ACCENT_SOLO,
    ACCENT_VS,
    bindBoardSwipe,
    BoardSession,
    computeDualSlots,
    computeSoloSlot,
    createSoloSession,
    GRADIENT,
    Match,
    randomSeed,
    type Bounds,
    type GameMode,
    type PlayerId,
  } from './game'
  import { buildTwenty48MenuPreview } from './game/menuPreview'
  import { createScreenPulse, type ScreenPulse } from './game/screenPulse'
  import { ANIM } from './game/tuning'
  import { ScoreBadgeNode } from './game/nodes/ScoreBadgeNode'
  import { PauseButtonNode } from './game/nodes/PauseButtonNode'
  import { TWENTY48_TUTORIAL } from './tutorial'
  import { TWENTY48_STRINGS as t } from './strings'
  import GameOver from './overlays/GameOver.svelte'
  import GameOverVersus from './overlays/GameOverVersus.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import SplashScreen from './overlays/SplashScreen.svelte'

  const { host, onExit, demoStage }: GameProps = $props()

  let showTutorial = $state(false)
  let showLeaderboard = $state(false)
  let screen = $state<'splash' | 'game'>('splash')
  let paused = $state(false)
  let soloResult = $state<{ score: number; bestTile: number } | null>(null)
  let versusResult = $state<{
    winner: 0 | 1 | 2
    scoreA: number
    scoreB: number
  } | null>(null)

  /**
   * Versus matches each seat has taken this visit, and whose tally moved last.
   * Shown under the title on the menu between matches.
   *
   * Not persisted: it belongs to the two people at the booth and starts over
   * for the next pair, which component state gives for free.
   */
  let matchWins = $state({ a: 0, b: 0 })
  let bumpPlayer = $state<PlayerId | null>(null)

  let anchor = $state<Node2D | null>(null)
  let gameRect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  // --- Non-reactive runtime state. Everything below drives canvas nodes
  // directly (there is no DOM to react through), so plain fields and
  // imperative updates stand in for `$state`/`$derived` chains.
  let mode: GameMode['kind'] | null = null
  let solo: BoardSession | null = null
  let match: Match | null = null
  let contentLayer: Node2D | null = null
  let hudLayer: Node2D | null = null
  let pauseButton: PauseButtonNode | null = null
  /** World depth of the booth's top-corner gesture boxes, refreshed on resize. */
  let cornerInset = 0
  let scoreA: ScoreBadgeNode | null = null
  let scoreB: ScoreBadgeNode | null = null
  let unbindInput: Array<() => void> = []
  let screenPulse: ScreenPulse | null = null
  /** Frozen at game over, since the player lingers on the result screen. */
  let gameStartMs = 0

  /**
   * Stashed by the game-over handlers with `durationMs` already fixed at that
   * moment. The record can only be finalized once the result screen knows
   * whether a name was entered, so the server call waits for its `onFinalize`.
   */
  let pendingSolo: { score: number; durationMs: number } | null = null

  function previewView(): Rect {
    return coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)
  }

  onMount(() => {
    const px = host.engine.renderer.pixelSize
    const css = host.engine.renderer.cssSize
    const view = gameVisibleRect(px.w, px.h)
    cornerInset = boothCornerInset(css.w, css.h)

    const uiAnchor = new Node2D('t48-ui-anchor')
    uiAnchor.transform.x = view.x
    uiAnchor.transform.y = view.y
    uiAnchor.debugBounds = {
      x: 0,
      y: 0,
      width: view.width,
      height: view.height,
    }
    host.engine.tree.root.add(uiAnchor)
    anchor = uiAnchor
    gameRect = view

    const backdrop = new GradientBackgroundNode({
      rect: view,
      topLeft: GRADIENT.topLeft,
      bottomRight: GRADIENT.bottomRight,
    })
    const content = new Node2D('t48-content')
    content.add(backdrop)
    host.engine.tree.root.add(content)
    contentLayer = content

    const chrome = new Node2D('t48-chrome')
    host.engine.tree.root.add(chrome)
    const pause = new PauseButtonNode(() => setPaused(true))
    pause.visible = false
    chrome.add(pause)
    pauseButton = pause

    screenPulse = createScreenPulse(host)

    const offResize = host.engine.events.on('resize', (e) => {
      const v = gameVisibleRect(e.pixel.w, e.pixel.h)
      uiAnchor.transform.x = v.x
      uiAnchor.transform.y = v.y
      gameRect = v
      cornerInset = boothCornerInset(e.css.w, e.css.h)
      backdrop.setRect(v)
      layoutBoards()
    })

    return () => {
      offResize()
      teardown()
      screenPulse?.destroy()
      screenPulse = null
      if (!content.isDestroyed) content.destroy()
      if (!chrome.isDestroyed) chrome.destroy()
      if (!uiAnchor.isDestroyed) uiAnchor.destroy()
      contentLayer = null
      pauseButton = null
    }
  })

  // The preview reads `gameRect`, so it is rebuilt on resize as well as on
  // entering the menu.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildTwenty48MenuPreview(host, previewView())
    return () => preview.destroy()
  })

  function teardown(): void {
    for (const off of unbindInput) off()
    unbindInput = []
    solo?.destroy()
    match?.destroy()
    solo = null
    match = null
    if (hudLayer && !hudLayer.isDestroyed) hudLayer.destroy()
    hudLayer = null
    scoreA = null
    scoreB = null
  }

  /** Score badge geometry above a board, derived from that board's slot. */
  function badgeRect(slot: Bounds): Bounds {
    const w = Math.min(slot.width * 0.42, 320)
    const h = Math.min(gameRect.height * 0.1, w * 0.42)
    return { x: slot.x, y: slot.y - h * 1.25, width: w, height: h }
  }

  function placeBadge(badge: ScoreBadgeNode, slot: Bounds): void {
    const r = badgeRect(slot)
    badge.setSize(r.width, r.height)
    badge.transform.x = r.x
    badge.transform.y = r.y
  }

  function layoutBoards(): void {
    if (mode === '1p' && solo) {
      const slot = computeSoloSlot(gameRect)
      solo.setSlot(slot)
      if (scoreA) placeBadge(scoreA, slot)
      placePauseButton(slot)
    } else if (mode === '2p' && match) {
      const { a, b } = computeDualSlots(gameRect)
      match.setSlots(a, b)
      if (scoreA) placeBadge(scoreA, a)
      if (scoreB) placeBadge(scoreB, b)
      placePauseButton(a)
    }
  }

  /**
   * The pause toggle, in the band above the board at the right.
   *
   * Inset from the right edge far enough to clear the booth's corner gesture,
   * which swallows corner taps outright. Sideways rather than down because down
   * is the board. At the region's design size the toggle already sits below the
   * gesture box, so this only bites on a smaller canvas, where a fixed-size box
   * covers more of the region.
   */
  function placePauseButton(slot: Bounds): void {
    if (!pauseButton) return
    const margin = Math.max(gameRect.width * 0.03, cornerInset)
    pauseButton.transform.x =
      gameRect.x + gameRect.width - PauseButtonNode.size - margin
    pauseButton.transform.y = slot.y - PauseButtonNode.size * 1.4
  }

  function startGame(m: GameMode): void {
    teardown()
    mode = m.kind
    screen = 'game'
    soloResult = null
    versusResult = null
    pendingSolo = null
    gameStartMs = performance.now()

    const hud = new Node2D('t48-hud')
    hudLayer = hud
    contentLayer?.add(hud)

    if (m.kind === '1p') {
      const slot = computeSoloSlot(gameRect)
      const s = createSoloSession(host, slot, randomSeed(), ACCENT_SOLO)
      solo = s
      contentLayer?.add(s.root)

      const badge = new ScoreBadgeNode(t.scoreLabel, ACCENT_SOLO, 1, 1)
      scoreA = badge
      hud.add(badge)
      placeBadge(badge, slot)

      s.events.on('score', (v) => badge.setValue(v))
      // Solo has the screen to itself, so every big merge can take it.
      s.events.on('milestone', (m) => {
        if (m.value >= ANIM.caPulseFrom) screenPulse?.fire()
      })
      s.events.on('goal', () => screenPulse?.fire(2))
      s.events.on('gameOver', (p) => {
        pendingSolo = {
          score: p.finalScore,
          durationMs: Math.round(performance.now() - gameStartMs),
        }
        soloResult = { score: p.finalScore, bestTile: s.highest }
      })
      bindSwipe(s)
      s.start()
    } else {
      const { a, b } = computeDualSlots(gameRect)
      const mt = new Match(host, a, b, randomSeed())
      match = mt
      contentLayer?.add(mt.a.root, mt.b.root)

      const badgeA = new ScoreBadgeNode(t.player1, ACCENT_VS[1], 1, 1)
      const badgeB = new ScoreBadgeNode(t.player2, ACCENT_VS[2], 1, 1)
      scoreA = badgeA
      scoreB = badgeB
      hud.add(badgeA, badgeB)
      placeBadge(badgeA, a)
      placeBadge(badgeB, b)

      mt.a.events.on('score', (v) => badgeA.setValue(v))
      mt.b.events.on('score', (v) => badgeB.setValue(v))
      // Versus pulses only for the goal itself. Flashing the whole screen
      // because the other player merged a 128 interrupts rather than shares.
      mt.a.events.on('goal', () => screenPulse?.fire(2))
      mt.b.events.on('goal', () => screenPulse?.fire(2))
      mt.events.on('matchOver', (r) => {
        versusResult = r
        // A tie credits neither seat, and clears the pulse so nothing flashes.
        matchWins = {
          a: matchWins.a + (r.winner === 1 ? 1 : 0),
          b: matchWins.b + (r.winner === 2 ? 1 : 0),
        }
        bumpPlayer = r.winner === 0 ? null : r.winner
      })
      bindSwipe(mt.a)
      bindSwipe(mt.b)
      mt.start()
    }

    if (pauseButton) pauseButton.visible = true
    layoutBoards()
  }

  function bindSwipe(session: BoardSession): void {
    unbindInput.push(
      bindBoardSwipe(host.engine, {
        geom: () => session.geom,
        enabled: () => session.state === 'playing' && !paused,
        onSwipe: (dir) => session.input(dir),
      }),
    )
  }

  function setPaused(next: boolean): void {
    paused = next
    host.engine.setPaused(next)
  }

  function toSplash(): void {
    setPaused(false)
    soloResult = null
    versusResult = null
    teardown()
    mode = null
    if (pauseButton) pauseButton.visible = false
    screen = 'splash'
  }

  function playAgain(): void {
    if (mode) startGame({ kind: mode })
  }

  function finalizeSoloLog(name: string): void {
    const log = pendingSolo
    if (!log) return
    pendingSolo = null
    recordArcadeGame({
      ...log,
      gameId: '2048',
      mode: 'solo',
      playerName: name || undefined,
    }).catch((e: unknown) => {
      console.warn('[2048] failed to record game to server', e)
    })
  }

  /**
   * One record per player, each with that player's own score and name, sharing
   * the match's winner and duration. Mirrors how solo logs one record per run.
   */
  function finalizeVersusLog(names: { a: string; b: string }): void {
    const r = versusResult
    if (!r) return
    const durationMs = Math.round(performance.now() - gameStartMs)
    const winner =
      r.winner === 0 ? 'tie' : r.winner === 1 ? 'player1' : 'player2'
    const base = { gameId: '2048', mode: 'versus', winner, durationMs } as const
    const warn = (e: unknown): void =>
      console.warn('[2048] failed to record game to server', e)
    recordArcadeGame({
      ...base,
      score: r.scoreA,
      playerName: names.a || undefined,
    }).catch(warn)
    recordArcadeGame({
      ...base,
      score: r.scoreB,
      playerName: names.b || undefined,
    }).catch(warn)
  }
</script>

<div class="t48">
  {#if anchor}
    <div
      class="t48__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if screen === 'splash'}
        <SplashScreen
          onStart={startGame}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
          onOpenLeaderboard={() => (showLeaderboard = true)}
          {matchWins}
          {bumpPlayer}
        />
      {/if}
      {#if soloResult}
        <GameOver
          score={soloResult.score}
          bestTile={soloResult.bestTile}
          onPlayAgain={playAgain}
          onMenu={toSplash}
          onFinalize={finalizeSoloLog}
        />
      {/if}
      {#if versusResult}
        <GameOverVersus
          winner={versusResult.winner}
          scoreA={versusResult.scoreA}
          scoreB={versusResult.scoreB}
          onPlayAgain={playAgain}
          onMenu={toSplash}
          onFinalize={finalizeVersusLog}
        />
      {/if}
      {#if paused}
        <PauseMenu onResume={() => setPaused(false)} onQuit={toSplash} />
      {/if}
      {#if showLeaderboard}
        <LeaderboardModal
          display="2048"
          onClose={() => (showLeaderboard = false)}
        />
      {/if}
    </div>
  {/if}

  <!-- Screen-space, not camera-anchored, so the demo renders at true
       resolution rather than through the region transform. -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={TWENTY48_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}
</div>

<style lang="sass">
  .t48
    position: absolute
    inset: 0
    pointer-events: none
    font-family: var(--font-text)

  .t48__ui
    pointer-events: none
</style>
