<script lang="ts">
  import { onMount } from 'svelte'
  import { Node2D, domAnchor, type Rect } from '@src/stargazer'
  import { coverView, gameVisibleRect, REGION_WIDTH, REGION_HEIGHT } from '../../world'
  import type { GameProps } from '../GameModule'
  import { BoardSession, type SessionState } from './game/session'
  import { Match } from './game/match'
  import { InputController } from './game/input'
  import { computeBoardBounds, computeDualBoardBounds, sideMargins } from './game/layout'
  import type { Bounds, TextSegment } from './game/types'
  import { BackdropNode } from './game/nodes/BackdropNode'
  import { ChromeNode } from './game/nodes/ChromeNode'
  import { HeartsNode } from './game/nodes/HeartsNode'
  import { BadgeNode } from './game/nodes/BadgeNode'
  import { ProgressNode } from './game/nodes/ProgressNode'
  import { CountdownNode } from './game/nodes/CountdownNode'
  import { WaitingNode } from './game/nodes/WaitingNode'
  import { VersusScoreNode } from './game/nodes/VersusScoreNode'
  import { PauseButtonNode } from './game/nodes/PauseButtonNode'
  import { ACCENT_SOLO, ACCENT_VS, COLORS, GRID, RULES } from './game/tuning'
  import type { GameMode } from './game/types'
  import { JEZZBALL_STRINGS as S } from './strings'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import { JEZZBALL_TUTORIAL } from './tutorial'
  import { buildJezzballMenuPreview } from './game/menuPreview'
  import LeaderboardModal from '../../leaderboard/LeaderboardModal.svelte'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import GameOver from './overlays/GameOver.svelte'
  import { recordArcadeGame } from '../../game-log'

  const { host, onExit, demoStage }: GameProps = $props()

  let showTutorial = $state(false)
  let showLeaderboard = $state(false)
  let screen = $state<'splash' | 'game'>('splash')
  let paused = $state(false)
  let showOver = $state(false)
  let overTitle = $state<TextSegment[]>([])
  let overScore = $state<TextSegment[]>([])
  let overLeaderboardScore = $state<number | undefined>(undefined)

  interface Hud {
    lives: number
    points: number
    level: number
    pct: number
    countdown: number
    state: SessionState
  }
  const newHud = (): Hud => ({
    lives: RULES.startLives,
    points: 0,
    level: 1,
    pct: 0,
    countdown: -1,
    state: 'idle',
  })
  const pad = (n: number): string => String(n).padStart(2, '0')
  const countLabel = (v: number): string => (v > 0 ? String(v) : v === 0 ? S.go : '')

  /** Timestamp a solo/versus session started, for the recorded game's `durationMs`. */
  let gameStartMs = 0

  /** Stashed by the `gameOver`/`matchOver` handlers below (with `durationMs`
   * already fixed at that moment, not later — the player may linger on the
   * game-over screen entering a name). The record can only be finalized once
   * `GameOver` knows whether a name was saved, so the actual server call
   * waits for its `onFinalize`. */
  let pendingLog: Omit<Parameters<typeof recordArcadeGame>[0], 'playerName'> | null = null
  function finalizeGameLog(name: string): void {
    if (!pendingLog) return
    const log = pendingLog
    pendingLog = null
    recordArcadeGame({ ...log, playerName: name || undefined }).catch((e: unknown) => {
      console.warn('[jezzball] failed to record game to server', e)
    })
  }

  // Node the overlays are pinned to, so the whole surface rides the camera.
  let anchor = $state<Node2D | null>(null)
  let gameRect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  /**
   * Cover rect for the menu preview: the whole visible area at the fixed
   * region aspect, left-anchored, so the preview reads as a full background
   * with no borders at any aspect (it crops rather than leaving gaps).
   */
  function previewView(): Rect {
    return coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)
  }

  // Stylized in-engine menu preview, up only while the splash is shown.
  // Reading `gameRect` makes this rebuild the preview when the window resizes.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildJezzballMenuPreview(host, previewView())
    return () => preview.destroy()
  })

  // --- Non-reactive runtime state. Everything below drives canvas nodes
  // directly (no DOM to react through), so plain fields + imperative updates
  // replace what used to be `$state`/`$derived` chains.
  let mode: GameMode['kind'] | null = null
  let hudA: Hud = newHud()
  let hudB: Hud = newHud()
  let solo: BoardSession | null = null
  let match: Match | null = null
  let input: InputController | null = null
  let soloBoard: Bounds | null = null
  let dualBoard: { a: Bounds; b: Bounds; orientation: 'row' | 'column' } | null = null

  // Persistent HUD node, created once in `onMount` and live for the whole
  // component (shown/hidden rather than rebuilt).
  let pauseButtonNode: PauseButtonNode | null = null

  // Board content (backdrop + every session's HUD) lives under this node, so
  // it always paints under `chromeLayer` (pause button, frame chrome) below
  // regardless of when a session starts or restarts.
  let contentLayer: Node2D | null = null

  // Per-session HUD nodes, rebuilt by `startSolo`/`startVersus` and torn down
  // as one group (`hudLayer.destroy()`) by `teardownGame`.
  let hudLayer: Node2D | null = null
  let heartsA: HeartsNode | null = null
  let heartsB: HeartsNode | null = null
  let badgeLvl: BadgeNode | null = null
  let badgePts: BadgeNode | null = null
  let scoreA: VersusScoreNode | null = null
  let scoreB: VersusScoreNode | null = null
  let progressNode: ProgressNode | null = null
  let countdownA: CountdownNode | null = null
  let countdownB: CountdownNode | null = null
  let waitingNode: WaitingNode | null = null

  /** Reposition/resize the solo HUD from the current `gameRect`/`soloBoard`. */
  function layoutSolo(): void {
    if (!soloBoard || !heartsA || !badgeLvl || !badgePts || !progressNode || !countdownA) return
    const margin = sideMargins(gameRect, soloBoard)
    const badgeSize = Math.min(margin.width * 0.82, gameRect.height * 0.34)
    const midY = gameRect.y + gameRect.height / 2
    const boardCenter = { x: soloBoard.x + soloBoard.width / 2, y: soloBoard.y + soloBoard.height / 2 }

    heartsA.transform.x = gameRect.x + gameRect.width / 2
    heartsA.transform.y = gameRect.y + gameRect.height * 0.04 + 19
    badgeLvl.setSize(badgeSize)
    badgeLvl.transform.x = margin.leftCenterX - badgeSize / 2
    badgeLvl.transform.y = midY - badgeSize / 2
    badgePts.setSize(badgeSize)
    badgePts.transform.x = margin.rightCenterX - badgeSize / 2
    badgePts.transform.y = midY - badgeSize / 2
    progressNode.setWidth(Math.min(gameRect.width * 0.4, 544))
    progressNode.transform.x = gameRect.x + gameRect.width / 2
    progressNode.transform.y = gameRect.y + gameRect.height * 0.965
    countdownA.transform.x = boardCenter.x
    countdownA.transform.y = boardCenter.y
  }

  /** Reposition/resize the versus HUD from the current `gameRect`/`dualBoard`. */
  function layoutVersus(): void {
    if (
      !dualBoard ||
      !heartsA ||
      !heartsB ||
      !scoreA ||
      !scoreB ||
      !badgeLvl ||
      !progressNode ||
      !countdownA ||
      !countdownB ||
      !waitingNode
    )
      return
    const { a, b, orientation } = dualBoard
    const vsGap =
      orientation === 'row' ? b.x - (a.x + a.width) : b.y - (a.y + a.height)
    const vsCenter =
      orientation === 'row'
        ? { x: (a.x + a.width + b.x) / 2, y: a.y + a.height / 2 }
        : { x: a.x + a.width / 2, y: (a.y + a.height + b.y) / 2 }
    const badgeSize = Math.min(vsGap * 0.72, Math.min(gameRect.width, gameRect.height) * 0.24)

    heartsA.transform.x = gameRect.x + gameRect.width * 0.04
    heartsA.transform.y = gameRect.y + gameRect.height * 0.08 + 11
    heartsB.transform.x = gameRect.x + gameRect.width * 0.96
    heartsB.transform.y = heartsA.transform.y
    scoreA.transform.x = vsCenter.x - vsGap / 2 - 12
    scoreA.transform.y = gameRect.y + gameRect.height * 0.04 + 36
    scoreB.transform.x = vsCenter.x + vsGap / 2 + 12
    scoreB.transform.y = scoreA.transform.y
    badgeLvl.setSize(badgeSize)
    badgeLvl.transform.x = vsCenter.x - badgeSize / 2
    badgeLvl.transform.y = vsCenter.y - badgeSize / 2
    progressNode.transform.x = gameRect.x + gameRect.width / 2
    progressNode.transform.y = gameRect.y + gameRect.height * 0.965
    countdownA.transform.x = a.x + a.width / 2
    countdownA.transform.y = a.y + a.height / 2
    countdownB.transform.x = b.x + b.width / 2
    countdownB.transform.y = b.y + b.height / 2
    waitingNode.transform.x = vsCenter.x
    waitingNode.transform.y = vsCenter.y
  }

  function syncSolo(): void {
    if (!heartsA || !badgeLvl || !badgePts || !progressNode || !countdownA) return
    heartsA.setLives(hudA.lives)
    badgeLvl.setValue(pad(hudA.level), hudA.level)
    badgePts.setValue(String(hudA.points), hudA.points)
    progressNode.setSolo(hudA.pct)
    countdownA.setLabel(hudA.state === 'countdown' ? countLabel(hudA.countdown) : null)
  }

  function syncVersus(): void {
    if (
      !heartsA ||
      !heartsB ||
      !scoreA ||
      !scoreB ||
      !badgeLvl ||
      !progressNode ||
      !countdownA ||
      !countdownB ||
      !waitingNode
    )
      return
    heartsA.setLives(hudA.lives)
    heartsB.setLives(hudB.lives)
    scoreA.setValue(hudA.points)
    scoreB.setValue(hudB.points)
    badgeLvl.setValue(pad(hudA.level), hudA.level)
    progressNode.setVersus(hudA.pct, hudB.pct)
    countdownA.setLabel(hudA.state === 'countdown' ? countLabel(hudA.countdown) : null)
    countdownB.setLabel(hudB.state === 'countdown' ? countLabel(hudB.countdown) : null)

    const waitingSide =
      hudA.state === 'cleared' && hudB.state !== 'cleared'
        ? 1
        : hudB.state === 'cleared' && hudA.state !== 'cleared'
          ? 2
          : 0
    waitingNode.setShown(waitingSide !== 0)
    if (waitingSide === 1) {
      waitingNode.transform.x = dualBoard!.a.x + dualBoard!.a.width / 2
      waitingNode.transform.y = dualBoard!.a.y + dualBoard!.a.height / 2
    } else if (waitingSide === 2) {
      waitingNode.transform.x = dualBoard!.b.x + dualBoard!.b.width / 2
      waitingNode.transform.y = dualBoard!.b.y + dualBoard!.b.height / 2
    }
  }

  function wire(session: BoardSession, hud: Hud, onChange: () => void): void {
    session.events.on('lives', (v) => {
      hud.lives = v
      onChange()
    })
    session.events.on('points', (v) => {
      hud.points = v
      onChange()
    })
    session.events.on('level', (v) => {
      hud.level = v
      onChange()
    })
    session.events.on('progress', (v) => {
      hud.pct = v
      onChange()
    })
    session.events.on('countdown', (v) => {
      hud.countdown = v
      onChange()
    })
    session.events.on('stateChanged', (v) => {
      hud.state = v
      onChange()
    })
  }

  function teardownGame(): void {
    input?.destroy()
    solo?.destroy()
    match?.destroy()
    input = null
    solo = null
    match = null
    soloBoard = null
    dualBoard = null
    if (hudLayer && !hudLayer.isDestroyed) hudLayer.destroy()
    hudLayer = null
    heartsA = null
    heartsB = null
    badgeLvl = null
    badgePts = null
    scoreA = null
    scoreB = null
    progressNode = null
    countdownA = null
    countdownB = null
    waitingNode = null
  }

  function showGameOver(
    title: TextSegment[],
    score: TextSegment[],
    leaderboardScore?: number,
  ): void {
    overTitle = title
    overScore = score
    overLeaderboardScore = leaderboardScore
    showOver = true
    if (pauseButtonNode) pauseButtonNode.visible = false
  }

  function hideGameOver(): void {
    showOver = false
  }

  function startSolo(): void {
    teardownGame()
    hideGameOver()
    mode = '1p'
    hudA = newHud()
    soloBoard = computeBoardBounds(gameRect)
    const s = new BoardSession(host, soloBoard, GRID.cols, GRID.rows, ACCENT_SOLO)
    // The session adds its board straight to the scene root; reparent it
    // under `contentLayer` (behind the HUD layer added next) so the field/
    // wall/ball nodes never paint over the countdown or other HUD overlays.
    contentLayer?.add(s.board.root)

    const layer = new Node2D('jb-hud-solo')
    contentLayer?.add(layer)
    hudLayer = layer
    heartsA = new HeartsNode({ max: RULES.maxLivesDisplay, color: COLORS.ink, align: 'center', sizePx: 38 })
    badgeLvl = new BadgeNode({ label: S.lvl, color: ACCENT_SOLO.primary, size: 1, labelCorner: 'tr', tabCorner: 'bl' })
    badgePts = new BadgeNode({ label: S.pts, color: ACCENT_SOLO.primary, size: 1, labelCorner: 'tl', tabCorner: 'br' })
    progressNode = new ProgressNode({ mode: 'solo', target: RULES.targetPct, width: 1 })
    countdownA = new CountdownNode()
    for (const n of [heartsA, badgeLvl, badgePts, progressNode, countdownA]) layer.add(n)
    layoutSolo()

    wire(s, hudA, syncSolo)
    s.events.on('gameOver', (p) => {
      showGameOver([], [], p.finalPoints)
      pendingLog = {
        score: p.finalPoints,
        gameId: 'jezzball',
        mode: 'solo',
        durationMs: Math.round(performance.now() - gameStartMs),
      }
    })
    syncSolo()
    solo = s
    input = new InputController(host, [s.board])
    gameStartMs = performance.now()
    s.start()
    if (pauseButtonNode) pauseButtonNode.visible = true
    screen = 'game'
  }

  function startVersus(): void {
    teardownGame()
    hideGameOver()
    mode = '2p'
    hudA = newHud()
    hudB = newHud()
    dualBoard = computeDualBoardBounds(gameRect)
    const { a, b } = dualBoard
    const m = new Match(host, a, b, GRID.cols, GRID.rows)
    // See the solo path above: reparent both boards under `contentLayer`
    // before the HUD layer so they never paint over the countdown/HUD.
    contentLayer?.add(m.a.board.root)
    contentLayer?.add(m.b.board.root)

    const layer = new Node2D('jb-hud-versus')
    contentLayer?.add(layer)
    hudLayer = layer
    heartsA = new HeartsNode({ max: RULES.maxLivesDisplay, color: ACCENT_VS[1].primary, align: 'left', sizePx: 22 })
    heartsB = new HeartsNode({ max: RULES.maxLivesDisplay, color: ACCENT_VS[2].primary, align: 'right', sizePx: 22 })
    scoreA = new VersusScoreNode(ACCENT_VS[1].primary, S.pts)
    scoreB = new VersusScoreNode(ACCENT_VS[2].primary, S.pts)
    badgeLvl = new BadgeNode({ label: S.lvl, color: ACCENT_SOLO.primary, size: 1, labelCorner: 'tr', tabCorner: 'bl' })
    progressNode = new ProgressNode({ mode: 'versus', target: RULES.targetPct, width: 1 })
    countdownA = new CountdownNode()
    countdownB = new CountdownNode()
    waitingNode = new WaitingNode(S.waitHeadline, S.waiting)
    for (const n of [heartsA, heartsB, scoreA, scoreB, badgeLvl, progressNode, countdownA, countdownB, waitingNode])
      layer.add(n)
    layoutVersus()

    wire(m.a, hudA, syncVersus)
    wire(m.b, hudB, syncVersus)
    match = m
    input = new InputController(host, [m.a.board, m.b.board])
    m.events.on('matchOver', (r) => {
      const title: TextSegment[] =
        r.winner === 0
          ? [{ text: S.tie, color: COLORS.ink }]
          : [
              { text: r.winner === 1 ? S.player1 : S.player2, color: r.winner === 1 ? ACCENT_VS[1].primary : ACCENT_VS[2].primary },
              { text: ` ${S.winsSuffix}`, color: COLORS.ink },
            ]
      showGameOver(title, [
        { text: String(r.pointsA), color: ACCENT_VS[1].primary },
        { text: ' · ', color: COLORS.ink },
        { text: String(r.pointsB), color: ACCENT_VS[2].primary },
      ])
      pendingLog = {
        score: Math.max(r.pointsA, r.pointsB),
        gameId: 'jezzball',
        mode: 'versus',
        winner: r.winner === 0 ? 'tie' : r.winner === 1 ? 'player1' : 'player2',
        durationMs: Math.round(performance.now() - gameStartMs),
      }
    })
    syncVersus()
    gameStartMs = performance.now()
    m.start()
    if (pauseButtonNode) pauseButtonNode.visible = true
    screen = 'game'
  }

  function onStart(m: GameMode): void {
    if (m.kind === '1p') startSolo()
    else startVersus()
  }

  function pause(): void {
    paused = true
    if (solo) solo.pause()
    else match?.pause()
  }
  function resume(): void {
    paused = false
    if (solo) solo.resume()
    else match?.resume()
  }
  function toSplash(): void {
    if (solo) solo.resume()
    else match?.resume()
    paused = false
    hideGameOver()
    if (pauseButtonNode) pauseButtonNode.visible = false
    teardownGame()
    mode = null
    screen = 'splash'
  }
  function playAgain(): void {
    if (mode === '1p') startSolo()
    else startVersus()
  }

  onMount(() => {
    const px = host.engine.renderer.pixelSize
    const view = gameVisibleRect(px.w, px.h)

    const uiAnchor = new Node2D('jezzball-ui-anchor')
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

    // Board content: the backdrop plus every session's HUD (added later, as
    // sessions start/restart). A dedicated container so it's always a single,
    // earlier sibling of `chromeLayer` below — painter order follows scene
    // order, so this guarantees the chrome/pause button stay on top no matter
    // when a session (re)builds its HUD, rather than depending on which
    // happened to get added to the scene first.
    const content = new Node2D('jb-content')
    host.engine.tree.root.add(content)
    contentLayer = content

    const bd = new BackdropNode(view)
    content.add(bd)

    // Always-on-top chrome: the pause toggle and the decorative frame.
    const chromeLayer = new Node2D('jb-chrome')
    host.engine.tree.root.add(chromeLayer)

    // The pause toggle starts hidden — the component always mounts on the
    // splash screen, not mid-game.
    const pauseBtn = new PauseButtonNode(pause)
    pauseBtn.transform.x = view.x + view.width * 0.96 - 38.4
    pauseBtn.transform.y = view.y + view.height * 0.16
    pauseBtn.visible = false
    chromeLayer.add(pauseBtn)
    pauseButtonNode = pauseBtn

    const chrome = new ChromeNode(view)
    chromeLayer.add(chrome)

    const offResize = host.engine.events.on('resize', (e) => {
      const v = gameVisibleRect(e.pixel.w, e.pixel.h)
      uiAnchor.transform.x = v.x
      uiAnchor.transform.y = v.y
      gameRect = v
      bd.setRect(v)
      chrome.setRect(v)
      pauseBtn.transform.x = v.x + v.width * 0.96 - 38.4
      pauseBtn.transform.y = v.y + v.height * 0.16
      if (mode === '1p') layoutSolo()
      else if (mode === '2p') layoutVersus()
    })

    return () => {
      offResize()
      teardownGame()
      if (!content.isDestroyed) content.destroy()
      if (!chromeLayer.isDestroyed) chromeLayer.destroy()
      if (!uiAnchor.isDestroyed) uiAnchor.destroy()
      contentLayer = null
    }
  })
</script>

<div class="jb">
  {#if anchor}
    <div
      class="jb__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if screen === 'splash'}
        <SplashScreen
          {onStart}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
          onOpenLeaderboard={() => (showLeaderboard = true)}
        />
      {/if}

      {#if showOver}
        <GameOver
          title={overTitle}
          score={overScore}
          leaderboardScore={overLeaderboardScore}
          onPlayAgain={playAgain}
          onMenu={toSplash}
          onFinalize={finalizeGameLog}
        />
      {/if}

      {#if paused}
        <PauseMenu onResume={resume} onQuit={toSplash} />
      {/if}

      {#if showLeaderboard}
        <LeaderboardModal display="jezzball" onClose={() => (showLeaderboard = false)} />
      {/if}
    </div>
  {/if}

  <!-- Screen-space tutorial (not camera-anchored, so its demo renders sharp). -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={JEZZBALL_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}
</div>

<style lang="sass">
  .jb
    position: absolute
    inset: 0
    pointer-events: none
    font-family: system-ui, sans-serif

  .jb__ui
    pointer-events: none
</style>
