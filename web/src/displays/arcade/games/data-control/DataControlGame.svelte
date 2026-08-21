<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Node2D,
    domAnchor,
    ignoreAbort,
    mixColor,
    type Rect,
  } from '@src/stargazer'
  import {
    coverView,
    gameVisibleRect,
    REGION_WIDTH,
    REGION_HEIGHT,
  } from '../../world'
  import type { GameProps } from '../GameModule'
  import { recordArcadeGame } from '../../game-log'
  import {
    startGame,
    type GameSession,
    type GameEvents,
    type StateId,
  } from './game'
  import { buildDataControlMenuPreview } from './game/menuPreview'
  import { BackdropNode } from './game/nodes/BackdropNode'
  import { BackgroundGridNode } from './game/nodes/BackgroundGridNode'
  import { DATA_CONTROL_STRINGS as t } from './strings'
  import { DATA_CONTROL_TUTORIAL } from './tutorial'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import GameOver from './overlays/GameOver.svelte'
  import StateConfirmCard from './overlays/StateConfirmCard.svelte'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import LeaderboardModal from '../../leaderboard/LeaderboardModal.svelte'

  const { host, onExit, demoStage, camera }: GameProps = $props()

  type GameOverPayload = GameEvents['gameOver']

  let screen = $state<'splash' | 'game'>('splash')
  let showTutorial = $state(false)
  let showLeaderboard = $state(false)
  let paused = $state(false)
  let loadError = $state<string | null>(null)

  // In-game UI state, driven by session events.
  let selectedStateId = $state<StateId | null>(null)
  let roundActive = $state(false)
  let score = $state(0)
  let gameOverPayload = $state<GameOverPayload | null>(null)
  const showOver = $derived(gameOverPayload !== null)
  const scoreDisplay = $derived(String(score).padStart(2, '0'))

  let session: GameSession | null = null

  /**
   * Stashed on `gameOver` with `durationMs` fixed at that moment (the player
   * may linger on the game-over card entering a name). The record is finalized
   * once `GameOver` knows whether a name was saved, via its `onFinalize`.
   */
  let pendingLog: Omit<
    Parameters<typeof recordArcadeGame>[0],
    'playerName'
  > | null = null
  function finalizeGameLog(name: string): void {
    if (!pendingLog) return
    const log = pendingLog
    pendingLog = null
    recordArcadeGame({ ...log, playerName: name || undefined }).catch(
      (e: unknown) => {
        console.warn('[data-control] failed to record game to server', e)
      },
    )
  }

  // Node the splash surface is pinned to, so it rides the camera on the way in.
  let anchor = $state<Node2D | null>(null)
  let gameRect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  /** Cover rect for the menu preview: the whole visible area at region aspect. */
  function previewView(): Rect {
    return coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)
  }

  // Stylized in-engine menu preview, up only while the splash is shown.
  // Reading `gameRect` rebuilds the preview when the window resizes.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildDataControlMenuPreview(host, previewView())
    return () => preview.destroy()
  })

  function wireSession(s: GameSession): void {
    s.events.on('stateSelected', (p) => (selectedStateId = p.stateId))
    s.events.on('selectionCanceled', () => (selectedStateId = null))
    s.events.on('roundStarted', () => {
      selectedStateId = null
      roundActive = true
      score = 0
    })
    s.events.on('packetScored', (p) => (score = p.total))
    s.events.on('gameOver', (p) => {
      roundActive = false
      gameOverPayload = p
      pendingLog = {
        score: p.score,
        gameId: 'data-control',
        mode: p.stateId,
        durationMs: p.durationMs,
      }
    })
    s.events.on('reset', () => {
      roundActive = false
      gameOverPayload = null
      score = 0
    })
  }

  async function play(): Promise<void> {
    if (session) return
    try {
      const s = await startGame(host, camera)
      session = s
      wireSession(s)
      screen = 'game'
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  function confirmSelection(): void {
    session?.startRound().catch(ignoreAbort)
  }

  function pause(): void {
    if (!session) return
    host.engine.setPaused(true)
    paused = true
  }
  function resume(): void {
    host.engine.setPaused(false)
    paused = false
  }

  function playAgain(): void {
    gameOverPayload = null
    session?.reset().catch(ignoreAbort)
  }

  /** Quit the run and return to the splash menu (camera back to region home). */
  function toSplash(): void {
    if (paused) resume()
    session?.destroy()
    session = null
    selectedStateId = null
    roundActive = false
    gameOverPayload = null
    score = 0
    camera.snapTo(camera.home())
    screen = 'splash'
  }

  onMount(() => {
    const px = host.engine.renderer.pixelSize
    const view = gameVisibleRect(px.w, px.h)

    // Solid black backdrop that fills the viewport each frame so the shared
    // arcade sky can never leak in when the camera zooms into a state (the
    // framing overshoots above the map for headroom, which a fixed
    // region-sized rect fails to cover). Its bottom is pinned to the game
    // region so it still scrolls away — never blacking out the launcher —
    // during the arcade's launcher<->game pan. `'static'` draws it above the
    // shared sky but below the map/preview.
    const backdrop = new BackdropNode({
      regionBottom: REGION_HEIGHT,
      fill: '#050505',
    })
    host.engine.tree.root.add(backdrop)

    // Green reference grid on the black backdrop, behind the map. Added after
    // the backdrop (so it paints on top of the black) and before the map
    // subtree (added on Play), which paints over it. Like the backdrop it fills
    // the viewport up to the region bottom, so it follows the camera into any
    // zoom instead of leaving a bare strip.
    const grid = new BackgroundGridNode({
      cell: 96,
      // The green accent mixed well toward black — a subtle green field grid.
      color: mixColor('#01CA05', '#050505', 0.68),
      regionBottom: REGION_HEIGHT,
    })
    host.engine.tree.root.add(grid)

    const uiAnchor = new Node2D('data-control-ui-anchor')
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

    const offResize = host.engine.events.on('resize', (e) => {
      const v = gameVisibleRect(e.pixel.w, e.pixel.h)
      uiAnchor.transform.x = v.x
      uiAnchor.transform.y = v.y
      gameRect = v
    })

    return () => {
      offResize()
      session?.destroy()
      session = null
      if (!backdrop.isDestroyed) backdrop.destroy()
      if (!grid.isDestroyed) grid.destroy()
      if (!uiAnchor.isDestroyed) uiAnchor.destroy()
      anchor = null
    }
  })
</script>

<div class="dc">
  <!-- Splash rides the camera into the game region (shown only pre-game). -->
  {#if anchor && screen === 'splash'}
    <div
      class="dc__anchored"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      <SplashScreen
        onPlay={play}
        {onExit}
        onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
        onOpenLeaderboard={() => (showLeaderboard = true)}
      />
    </div>
  {/if}

  <!-- In-game overlays are screen-space so they stay stable while the camera
       zooms into a state. -->
  <div class="dc__screen">
    {#if screen === 'game' && !showOver && !paused}
      <button class="dc__pause" onclick={pause} aria-label={t.paused}>‖</button>
    {/if}

    {#if roundActive && !showOver}
      <div class="dc__score" aria-hidden="true">{scoreDisplay}</div>
    {/if}

    {#if selectedStateId && !showOver}
      <StateConfirmCard
        stateId={selectedStateId}
        onConfirm={confirmSelection}
      />
    {/if}

    {#if gameOverPayload}
      <GameOver
        reason={gameOverPayload.reason}
        escapeHeadingRad={gameOverPayload.escapeHeadingRad}
        score={gameOverPayload.score}
        {host}
        onPlayAgain={playAgain}
        onMenu={toSplash}
        onFinalize={finalizeGameLog}
      />
    {/if}

    {#if paused}
      <PauseMenu onResume={resume} onQuit={toSplash} />
    {/if}

    {#if showLeaderboard}
      <LeaderboardModal
        display="data-control"
        onClose={() => (showLeaderboard = false)}
      />
    {/if}

    {#if loadError}
      <div class="dc__center"><p class="dc__hint">{loadError}</p></div>
    {/if}
  </div>

  <!-- Screen-space tutorial (not camera-anchored, so its demo renders sharp). -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={DATA_CONTROL_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}
</div>

<style lang="sass">
  .dc
    position: absolute
    inset: 0
    pointer-events: none
    font-family: system-ui, sans-serif

  .dc__anchored
    pointer-events: none

  .dc__screen
    position: absolute
    inset: 0
    pointer-events: none

  .dc__pause
    position: absolute
    inset-block-start: var(--space-32)
    inset-inline-end: var(--space-32)
    width: 4rem
    height: 4rem
    border: none
    border-radius: 50%
    background: var(--color-surface-card)
    color: var(--color-text)
    box-shadow: var(--color-shadow-card)
    font-size: 1.5rem
    line-height: 1
    cursor: pointer
    pointer-events: auto

  // Big watermark score. Hollow: a green outline (no fill) so it reads on the
  // black backdrop without competing with the map.
  .dc__score
    position: absolute
    inset-block-end: var(--space-48)
    inset-inline-end: var(--space-48)
    @include tint.type-class(watermark)
    color: transparent
    -webkit-text-stroke: 0.12rem var(--color-accent)
    font-variant-numeric: slashed-zero tabular-nums
    line-height: 0.9
    pointer-events: none

  .dc__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    pointer-events: none

  .dc__hint
    color: var(--color-text)
</style>
