<script lang="ts">
  import { onMount } from 'svelte'
  import { domAnchor, type Rect } from '@src/stargazer'
  import { coverView, REGION_WIDTH, REGION_HEIGHT } from '../../world'
  import type { GameProps } from '../GameModule'
  import {
    startGame,
    type GameMode,
    type GameSession,
    type MatchScore,
    type TeamCounts,
    type TeamId,
  } from './game'
  import { ORBO_STRINGS } from './strings'
  import { recordArcadeGame } from '../../game-log'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import Score from '@src/core/ui/Score.svelte'
  import PauseMenu from '@src/displays/arcade/menu/PauseMenu.svelte'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import { ORBO_TUTORIAL } from './tutorial'
  import { buildOrboMenuPreview } from './game/menuPreview'

  /** Equal padding (world units) between the field and the game-view edges. */
  const FIELD_PADDING = 48

  // `onExit` hands control back to the arcade (used by the splash's "Return to
  // Launcher"). Overlays ride the camera via `domAnchor`, so there's no fade gate.
  const { host, onExit, demoStage, region }: GameProps = $props()

  // Whether the "How to play" modal is open (splash-only entry point).
  let showTutorial = $state(false)

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  // The main screen shows when idle, playing shows the field, paused overlays
  // the pause menu. (Round-end is a pure canvas animation, no screen here.)
  let showSplash = $state(true)
  let paused = $state(false)
  // Live pause-swipe progress (0..1) for drag feedback before it commits.
  let pausePreview = $state(0)
  let matchScore = $state<MatchScore>({ teamL: 0, teamR: 0 })
  // Side whose score just ticked up, so the splash can bump it on return.
  let bumpTeam = $state<TeamId | null>(null)

  // A finished round is the unit the game log records. Orbo has no game-over
  // card to finalize from, so the record goes out as the round is tallied.
  let mode: GameMode = '1v1'
  let roundStartMs = 0

  function logRound(winner: TeamId | null, counts: TeamCounts): void {
    void recordArcadeGame({
      gameId: 'orbo',
      mode,
      winner: winner === null ? 'tie' : winner === 0 ? 'left' : 'right',
      // Scoring orbs held by the winning side, which is what decided the round.
      score: winner === null ? 0 : winner === 0 ? counts.teamL : counts.teamR,
      durationMs: Math.round(performance.now() - roundStartMs),
    }).catch((e: unknown) => {
      console.warn('[orbo] failed to record game to server', e)
    })
  }
  // Node the menu overlay is pinned to, so it pans with the game region when the
  // arcade camera moves between the game and the launcher.
  const anchor = $derived(region.anchor)
  // Overlay bounds = the game region's visible rect (full canvas, adopting its
  // aspect), so the splash/pause menus fill the window and reflow on resize.
  const gameRect = $derived(region.rect)

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
    const preview = buildOrboMenuPreview(host, previewView())
    return () => preview.destroy()
  })

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    const view = region.rect

    // The field reflows on the next entry. Mid-match field reflow is a separate
    // step.
    const offResize = region.onResize((v) => {
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
        sess.events.on('matchStarted', (p) => {
          bumpTeam = null
          showSplash = false
          mode = p.mode
          roundStartMs = performance.now()
        })
        sess.events.on('roundOver', (p) => {
          matchScore = p.matchScore
          bumpTeam = p.winner
          logRound(p.winner, p.counts)
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
      offResize()
      s?.destroy()
    }
  })

  function startMatch(m: GameMode): void {
    session?.startMatch(m)
  }
  function resume(): void {
    session?.resume()
  }
  function quit(): void {
    // Quitting from the pause menu is a plain return, no winner bump.
    bumpTeam = null
    session?.reset()
  }
</script>

<!--
  Every overlay is pinned to the game region through one `domAnchor` wrapper, so
  the whole surface rides the arcade camera: a pan slides it off screen and
  `cull` hides it there. Errors stay outside the wrapper so a failure surfaces
  even mid-transition.
-->
<div class="orbo">
  {#if anchor}
    <div
      class="orbo__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if !session && !loadError}
        <div class="orbo__center">
          <p class="orbo__hint">{ORBO_STRINGS.loading}</p>
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

      {#if session && (paused || pausePreview > 0)}
        <PauseMenu
          progress={paused ? 1 : pausePreview}
          onResume={resume}
          onQuit={quit}
        >
          {#snippet detail()}
            <Score left={matchScore.teamL} right={matchScore.teamR} />
          {/snippet}
        </PauseMenu>
      {/if}
    </div>
  {/if}

  <!--
    Screen-space tutorial modal: a sibling of the `domAnchor` wrapper (NOT
    camera-anchored) so the demo canvas renders at true resolution.
  -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={ORBO_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}

  {#if loadError}
    <div class="orbo__center">
      <p class="orbo__hint">{loadError}</p>
    </div>
  {/if}
</div>

<style lang="sass">
  // Overlay layer above the shared arcade canvas. Transparent + click-through.
  // Only the interactive overlays capture pointer events.
  .orbo
    position: absolute
    inset: 0
    pointer-events: none

  // The engine positions this over the game region (via `domAnchor`), sized in
  // world units and scaled by the camera. The overlays inside fill it. Stays
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
