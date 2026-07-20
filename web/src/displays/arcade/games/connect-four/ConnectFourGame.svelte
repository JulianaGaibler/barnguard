<script lang="ts">
  import { onMount } from 'svelte'
  import { SceneNode, domAnchor } from '@src/stargazer'
  import { gameVisibleRect, REGION_WIDTH, REGION_HEIGHT } from '../../world'
  import type { GameProps } from '../GameModule'
  import {
    startGame,
    type GameMode,
    type GameSession,
    type MatchScore,
    type Player,
  } from './game'
  import { CF_STRINGS } from './strings'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import TurnIndicator from './overlays/TurnIndicator.svelte'

  /** Equal padding (world units) between the board area and the game-view edges. */
  const FIELD_PADDING = 48

  // Overlays ride the camera via `domAnchor`, so there's no fade gate.
  const { host, onExit }: GameProps = $props()

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  let showSplash = $state(true)
  let paused = $state(false)
  let matchScore = $state<MatchScore>({ teamL: 0, teamR: 0 })
  // Player whose score just ticked up, so the splash bumps it on return.
  let bumpTeam = $state<Player | null>(null)
  // Whose-turn tracking for the indicator (driven by turnChanged, so it flips
  // after a disc lands, not the instant a move is committed).
  let currentMode = $state<GameMode | null>(null)
  let turn = $state<Player | null>(null)
  // Node the overlays are pinned to, so the whole surface rides the camera.
  let anchor = $state<SceneNode | null>(null)

  const showTurn = $derived(
    !!session && !showSplash && !paused && turn !== null,
  )
  const aiThinking = $derived(currentMode?.kind === 'ai' && turn === 2)
  const turnColor = $derived(
    turn === 2 ? 'var(--color-team-b)' : 'var(--color-team-a)',
  )
  const turnLabel = $derived(
    currentMode?.kind === 'ai'
      ? turn === 1
        ? CF_STRINGS.yourTurn
        : CF_STRINGS.thinking
      : turn === 1
        ? CF_STRINGS.player1
        : CF_STRINGS.player2,
  )

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    // UI-only node at the game region's origin; the overlays attach to it.
    const uiAnchor = new SceneNode('connect-four-ui-anchor')
    uiAnchor.debugBounds = {
      x: 0,
      y: 0,
      width: REGION_WIDTH,
      height: REGION_HEIGHT,
    }
    host.engine.scene.root.add(uiAnchor)
    anchor = uiAnchor

    const px = host.engine.renderer.pixelSize
    const view = gameVisibleRect(px.w, px.h)
    const bounds = {
      x: view.x + FIELD_PADDING,
      y: view.y + FIELD_PADDING,
      width: view.width - FIELD_PADDING * 2,
      height: view.height - FIELD_PADDING * 2,
    }
    startGame(host, bounds)
      .then((sess) => {
        if (disposed) {
          sess.destroy()
          return
        }
        s = sess
        session = sess
        matchScore = sess.matchScore
        sess.events.on('matchStarted', (p) => {
          currentMode = p.mode
          bumpTeam = null
          showSplash = false
        })
        sess.events.on('turnChanged', (p) => {
          turn = p.player
        })
        sess.events.on('roundOver', (p) => {
          matchScore = p.matchScore
          bumpTeam = p.winner
          turn = null // game decided; hide the turn banner during the celebration
        })
        sess.events.on('reset', () => {
          paused = false
          showSplash = true
          turn = null
          currentMode = null
        })
        sess.events.on('scoresReset', () => {
          matchScore = { teamL: 0, teamR: 0 }
          bumpTeam = null
        })
        sess.events.on('paused', () => {
          paused = true
        })
        sess.events.on('resumed', () => {
          paused = false
        })
      })
      .catch((err: unknown) => {
        loadError = err instanceof Error ? err.message : String(err)
      })
    return () => {
      disposed = true
      s?.destroy()
      if (!uiAnchor.isDestroyed) uiAnchor.destroy()
    }
  })

  function startMatch(m: GameMode): void {
    session?.startMatch(m)
  }
  function resume(): void {
    session?.resume()
  }
  function quit(): void {
    bumpTeam = null
    session?.reset()
  }
</script>

<div class="cf">
  {#if anchor}
    <div
      class="cf__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: REGION_WIDTH, height: REGION_HEIGHT },
        cull: true,
      }}
    >
      {#if !session && !loadError}
        <div class="cf__center">
          <p class="cf__hint">{CF_STRINGS.loading}</p>
        </div>
      {/if}

      {#if showTurn}
        <TurnIndicator label={turnLabel} color={turnColor} pulse={aiThinking} />
      {/if}

      {#if session && showSplash}
        <SplashScreen {matchScore} {bumpTeam} onStart={startMatch} {onExit} />
      {/if}

      {#if session && paused}
        <PauseMenu {matchScore} onResume={resume} onQuit={quit} />
      {/if}
    </div>
  {/if}

  {#if loadError}
    <div class="cf__center">
      <p class="cf__hint">{loadError}</p>
    </div>
  {/if}
</div>

<style lang="sass">
  .cf
    position: absolute
    inset: 0
    pointer-events: none

  // Region-pinned wrapper (positioned by `domAnchor`); click-through so only the
  // overlays' own controls capture pointer events.
  .cf__ui
    pointer-events: none

  .cf__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    pointer-events: none

  .cf__hint
    color: #f5f7fa
</style>
