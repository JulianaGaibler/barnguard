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
    type Player,
  } from './game'
  import { CF_STRINGS } from './strings'
  import { recordArcadeGame } from '../../game-log'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import Score from '@src/core/ui/Score.svelte'
  import PauseMenu from '@src/displays/arcade/menu/PauseMenu.svelte'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import { CONNECT_FOUR_TUTORIAL } from './tutorial'
  import { buildConnectFourMenuPreview } from './game/menuPreview'

  /** Equal padding (world units) between the board area and the game-view edges. */
  const FIELD_PADDING = 48

  // Overlays ride the camera via `domAnchor`, so there's no fade gate.
  const { host, onExit, demoStage, region }: GameProps = $props()

  // Whether the "How to play" modal is open (splash-only entry point).
  let showTutorial = $state(false)

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  let showSplash = $state(true)
  let paused = $state(false)
  let matchScore = $state<MatchScore>({ teamL: 0, teamR: 0 })
  // Player whose score just ticked up, so the splash bumps it on return.
  let bumpTeam = $state<Player | null>(null)

  // A finished round is the unit the game log records. The mode and the clock
  // are held here because `roundOver` carries neither, and the game returns to
  // the menu on its own afterwards, so there is no card to finalize from.
  let mode: GameMode = { kind: '2p' }
  let roundStartMs = 0

  /** The free-form log tag: the two humans, or the strength they picked. */
  function modeTag(m: GameMode): string {
    return m.kind === '2p' ? 'versus' : `ai-${m.difficulty}`
  }

  function logRound(winner: Player | null): void {
    void recordArcadeGame({
      gameId: 'connect-four',
      mode: modeTag(mode),
      winner: winner === null ? 'tie' : `player${winner}`,
      // Connect Four keeps no points, so the score is the winning side's
      // running total of rounds this visit, which is what the game reads as.
      score:
        winner === 1 ? matchScore.teamL : winner === 2 ? matchScore.teamR : 0,
      durationMs: Math.round(performance.now() - roundStartMs),
    }).catch((e: unknown) => {
      console.warn('[connect-four] failed to record game to server', e)
    })
  }
  // Node the overlays are pinned to, so the whole surface rides the camera.
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
    const preview = buildConnectFourMenuPreview(host, previewView())
    return () => preview.destroy()
  })

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    const view = region.rect

    // The board reflows on the next entry. Mid-match board reflow is a separate
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
        sess.events.on('matchStarted', () => {
          bumpTeam = null
          showSplash = false
          roundStartMs = performance.now()
        })
        sess.events.on('roundOver', (p) => {
          matchScore = p.matchScore
          bumpTeam = p.winner
          logRound(p.winner)
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
    }
  })

  function startMatch(m: GameMode): void {
    mode = m
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
        <PauseMenu onResume={resume} onQuit={quit}>
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

  // Region-pinned wrapper (positioned by `domAnchor`). Click-through so only the
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
    color: var(--color-text)
</style>
