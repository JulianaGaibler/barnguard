<script lang="ts">
  import { onMount } from 'svelte'
  import { Node2D, domAnchor, type Rect } from '@src/stargazer'
  import {
    coverView,
    gameVisibleRect,
    REGION_WIDTH,
    REGION_HEIGHT,
  } from '../../world'
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
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import { CONNECT_FOUR_TUTORIAL } from './tutorial'
  import { buildConnectFourMenuPreview } from './game/menuPreview'

  /** Equal padding (world units) between the board area and the game-view edges. */
  const FIELD_PADDING = 48

  // Overlays ride the camera via `domAnchor`, so there's no fade gate.
  const { host, onExit, demoStage }: GameProps = $props()

  // Whether the "How to play" modal is open (splash-only entry point).
  let showTutorial = $state(false)

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  let showSplash = $state(true)
  let paused = $state(false)
  let matchScore = $state<MatchScore>({ teamL: 0, teamR: 0 })
  // Player whose score just ticked up, so the splash bumps it on return.
  let bumpTeam = $state<Player | null>(null)
  // Node the overlays are pinned to, so the whole surface rides the camera.
  let anchor = $state<Node2D | null>(null)
  // Overlay bounds = the game region's visible rect (full canvas, adopting its
  // aspect), so the splash/pause menus fill the window and reflow on resize.
  let gameRect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  /**
   * Cover rect for the menu preview: the whole visible area at the fixed region
   * aspect, left-anchored, so the preview reads as a full background with no
   * borders at any aspect (it crops rather than leaving gaps).
   */
  function previewView(): Rect {
    return coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)
  }

  // Stylized in-engine menu preview on the primary stage, up only while the menu
  // is (built when the session is idle, destroyed on match start / unmount).
  // Reading `gameRect` makes this rebuild the preview when the window resizes.
  $effect(() => {
    if (!showSplash || !session) return
    const preview = buildConnectFourMenuPreview(host, previewView())
    return () => preview.destroy()
  })

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    const px = host.engine.renderer.pixelSize
    const view = gameVisibleRect(px.w, px.h)

    // UI-only node at the game region's visible-rect top-left; the overlays
    // attach to it and cover the whole visible area so the menus fill the window.
    const uiAnchor = new Node2D('connect-four-ui-anchor')
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

    // Keep the overlay fitted as the window resizes. The board reflows on the
    // next entry; mid-match board reflow is a separate step.
    const offResize = host.engine.events.on('resize', (e) => {
      const v = gameVisibleRect(e.pixel.w, e.pixel.h)
      uiAnchor.transform.x = v.x
      uiAnchor.transform.y = v.y
      gameRect = v
      s?.resize(v)
    })

    const bounds = {
      x: view.x + FIELD_PADDING,
      y: view.y + FIELD_PADDING,
      width: view.width - FIELD_PADDING * 2,
      height: view.height - FIELD_PADDING * 2,
    }
    startGame(host, bounds, view)
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
          showSplash = true
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
      offResize()
      s?.destroy()
      uiAnchor.destroy()
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
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if !session && !loadError}
        <div class="cf__center">
          <p class="cf__hint">{CF_STRINGS.loading}</p>
        </div>
      {/if}

      {#if session && showSplash}
        <SplashScreen
          {matchScore}
          {bumpTeam}
          onStart={startMatch}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
        />
      {/if}

      {#if session && paused}
        <PauseMenu {matchScore} onResume={resume} onQuit={quit} />
      {/if}
    </div>
  {/if}

  <!--
    Screen-space tutorial modal: a sibling of the `domAnchor` wrapper (NOT
    camera-anchored) so the demo canvas renders at true resolution.
  -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={CONNECT_FOUR_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
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
