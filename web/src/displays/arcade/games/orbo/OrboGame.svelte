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
    type TeamId,
  } from './game'
  import { ORBO_STRINGS } from './strings'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'

  /** Equal padding (world units) between the field and the game-view edges. */
  const FIELD_PADDING = 48

  // `onExit` hands control back to the arcade (used by the splash's "Return to
  // Launcher"). Overlays ride the camera via `domAnchor`, so there's no fade gate.
  const { host, onExit }: GameProps = $props()

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  // The main screen shows when idle; playing shows the field; paused overlays
  // the pause menu. (Round-end is a pure canvas animation — no screen here.)
  let showSplash = $state(true)
  let paused = $state(false)
  // Live pause-swipe progress (0..1) for drag feedback before it commits.
  let pausePreview = $state(0)
  let matchScore = $state<MatchScore>({ teamL: 0, teamR: 0 })
  // Side whose score just ticked up, so the splash can bump it on return.
  let bumpTeam = $state<TeamId | null>(null)
  // Node the menu overlay is pinned to, so it pans with the game region when the
  // arcade camera moves between the game and the launcher.
  let anchor = $state<SceneNode | null>(null)

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    // A UI-only node at the game region's origin (world 0,0), sized to the
    // region. The splash overlay attaches to it via `domAnchor`, so the engine
    // keeps it flush with the canvas through camera pans.
    const uiAnchor = new SceneNode('orbo-ui-anchor')
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
        sess.events.on('matchStarted', () => {
          bumpTeam = null
          showSplash = false
        })
        sess.events.on('roundOver', (p) => {
          matchScore = p.matchScore
          bumpTeam = p.winner
        })
        sess.events.on('reset', () => {
          paused = false
          pausePreview = 0
          showSplash = true
        })
        sess.events.on('scoresReset', () => {
          matchScore = { teamL: 0, teamR: 0 }
          bumpTeam = null
        })
        sess.events.on('paused', () => {
          paused = true
          pausePreview = 0
        })
        sess.events.on('resumed', () => {
          paused = false
          pausePreview = 0
        })
        sess.events.on('pauseProgress', (p) => {
          pausePreview = p
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
    // Quitting from the pause menu is a plain return — no winner bump.
    bumpTeam = null
    session?.reset()
  }
</script>

<!--
  Every overlay is pinned to the game region through one `domAnchor` wrapper, so
  the whole surface rides the arcade camera: a pan slides it off screen and
  `cull` hides it there, replacing the old fade handshake. Errors stay outside
  the wrapper so a failure surfaces even mid-transition.
-->
<div class="orbo">
  {#if anchor}
    <div
      class="orbo__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: REGION_WIDTH, height: REGION_HEIGHT },
        cull: true,
      }}
    >
      {#if !session && !loadError}
        <div class="orbo__center">
          <p class="orbo__hint">{ORBO_STRINGS.loading}</p>
        </div>
      {/if}

      {#if session && showSplash}
        <SplashScreen {matchScore} {bumpTeam} onStart={startMatch} {onExit} />
      {/if}

      {#if session && (paused || pausePreview > 0)}
        <PauseMenu
          {matchScore}
          progress={paused ? 1 : pausePreview}
          onResume={resume}
          onQuit={quit}
        />
      {/if}
    </div>
  {/if}

  {#if loadError}
    <div class="orbo__center">
      <p class="orbo__hint">{loadError}</p>
    </div>
  {/if}
</div>

<style lang="sass">
  // Overlay layer above the shared arcade canvas. Transparent + click-through;
  // only the interactive overlays capture pointer events.
  .orbo
    position: absolute
    inset: 0
    pointer-events: none

  // The engine positions this over the game region (via `domAnchor`), sized in
  // world units and scaled by the camera; the overlays inside fill it. Stays
  // click-through so only their own buttons capture pointer events.
  .orbo__ui
    pointer-events: none

  .orbo__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    pointer-events: none

  .orbo__hint
    color: #f5f7fa
</style>
