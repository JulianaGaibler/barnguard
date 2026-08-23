<script lang="ts">
  import { onMount } from 'svelte'
  import { Node2D, domAnchor, type Rect } from '@src/stargazer'
  import { PauseButtonNode } from '../common/PauseButtonNode'
  import {
    boothCornerInset,
    gameVisibleRect,
    REGION_HEIGHT,
    REGION_WIDTH,
  } from '../../world'
  import type { GameProps } from '../GameModule'
  import {
    centreColumn,
    helpFocus,
    startGame,
    type Card,
    type ChoicePrompt as ChoicePromptData,
    type GameMode,
    type GameOverView,
    type GameSession,
  } from './game'
  import { COLORS } from './game/tuning'
  import { FS_STRINGS as t } from './strings'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import GameOver from './overlays/GameOver.svelte'
  import ChoicePrompt from './overlays/ChoicePrompt.svelte'
  import HelpSheet from './overlays/HelpSheet.svelte'
  import HowToPlay from '@src/displays/arcade/tutorial/HowToPlay.svelte'
  import { FULL_STACK_TUTORIAL } from './tutorial'

  // Overlays ride the camera via `domAnchor`, so there is no fade gate.
  const { host, onExit, demoStage }: GameProps = $props()

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  let showSplash = $state(true)
  let paused = $state(false)
  let mode = $state<GameMode>({ kind: 'versus' })
  let result = $state<GameOverView | null>(null)

  /** The pause toggle, hidden outside a live match. */
  let pauseButton: PauseButtonNode | null = null

  /** Side length of the pause toggle, as a fraction of the region's short side. */
  const PAUSE_FRAC = 0.045

  /** World depth of the booth's top-corner gesture boxes, refreshed on resize. */
  let cornerInset = 0

  /**
   * Sit the pause toggle in the free band above the orgs, at the right.
   *
   * Inset from the right edge far enough to clear the booth's corner gesture,
   * which swallows corner taps outright. The clearance has to come out of the
   * width here: the band above the orgs is shallower than the gesture box, so
   * moving the toggle down instead would land it on the top row of cards.
   */
  function placePause(btn: PauseButtonNode, view: Rect): void {
    const size = Math.min(view.width, view.height) * PAUSE_FRAC
    const margin = size * 0.34
    btn.setSize(size)
    btn.transform.x = view.x + view.width - Math.max(margin, cornerInset) - size
    btn.transform.y = view.y + margin
  }

  /**
   * Matches each side has taken this visit, and which side's tally moved last.
   * Shown under the title on the menu between matches.
   *
   * Tracked per mode: a win over the machine and a win over the person next to
   * you are not the same thing to count together, so switching mode starts
   * over. Never persisted, since the tally belongs to whoever is standing here
   * now.
   */
  let matchWins = $state<{ kind: GameMode['kind']; a: number; b: number }>({
    kind: 'versus',
    a: 0,
    b: 0,
  })
  let bumpSide = $state<0 | 1 | null>(null)
  let choice = $state<ChoicePromptData | null>(null)
  let helpCard = $state<Card | null>(null)
  let helpMode = $state(false)
  let showTutorial = $state(false)
  let anchor = $state<Node2D | null>(null)
  let gameRect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  onMount(() => {
    let disposed = false
    let s: GameSession | null = null

    const px = host.engine.renderer.pixelSize
    const css = host.engine.renderer.cssSize
    const view = gameVisibleRect(px.w, px.h)
    cornerInset = boothCornerInset(css.w, css.h)

    const uiAnchor = new Node2D('full-stack-ui-anchor')
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
      cornerInset = boothCornerInset(e.css.w, e.css.h)
      if (pauseButton) placePause(pauseButton, v)
      s?.resize(v)
    })

    startGame(host, view)
      .then((sess) => {
        // Building the scene is async, so a swipe out before it resolves would
        // otherwise strand the subtree in the scene for the rest of the session.
        if (disposed) {
          sess.destroy()
          return
        }
        s = sess
        session = sess

        // Added only now, and so after the session's own subtree. Within a
        // layer paint order is tree order and the hit walk runs back to front,
        // so a button added before the table sat under its backdrop and never
        // saw a tap. Sits in the band above the two orgs, at the right, where
        // the arcade's return gesture cannot reach it: that only arms across
        // the middle third of the top edge.
        const pauseBtn = new PauseButtonNode({
          onClick: () => session?.pause(),
          fill: COLORS.panel,
          ink: COLORS.ink,
        })
        placePause(pauseBtn, gameRect)
        pauseBtn.visible = !showSplash
        host.engine.tree.root.add(pauseBtn)
        pauseButton = pauseBtn
        sess.events.on('matchStarted', (p) => {
          mode = p.mode
          result = null
          showSplash = false
          if (pauseButton) pauseButton.visible = true
        })
        sess.events.on('gameOver', (p) => {
          result = p
          const kind = mode.kind
          const running =
            matchWins.kind === kind ? matchWins : { kind, a: 0, b: 0 }
          // A tie credits neither side, and clears the pulse so nothing flashes.
          matchWins = {
            kind,
            a: running.a + (p.winner === 0 ? 1 : 0),
            b: running.b + (p.winner === 1 ? 1 : 0),
          }
          bumpSide = p.winner
        })
        sess.events.on('choice', (p) => {
          choice = p
        })
        sess.events.on('help', (p) => {
          helpCard = p?.card ?? null
        })
        sess.events.on('helpMode', (on) => {
          helpMode = on
        })
        sess.events.on('reset', () => {
          paused = false
          result = null
          showSplash = true
          if (pauseButton) pauseButton.visible = false
        })
        sess.events.on('paused', () => {
          paused = true
          if (pauseButton) pauseButton.visible = false
        })
        sess.events.on('resumed', () => {
          paused = false
          if (pauseButton) pauseButton.visible = !showSplash
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
      if (pauseButton && !pauseButton.isDestroyed) pauseButton.destroy()
      pauseButton = null
    }
  })

  const startMatch = (m: GameMode): void => session?.startMatch(m)
  const quit = (): void => session?.reset()

  // The breakdown takes over the column the shortlists were in, so it tracks
  // the same measurement the board does and follows a resize with it.
  const panel = $derived(centreColumn(gameRect))
  const helpSheet = $derived(helpFocus(gameRect).sheet)
</script>

<div class="oo">
  {#if anchor}
    <div
      class="oo__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if !session && !loadError}
        <div class="oo__center"><p class="oo__hint">{t.loading}</p></div>
      {/if}

      {#if session && showSplash}
        <SplashScreen
          onStart={startMatch}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
          matchWins={{ a: matchWins.a, b: matchWins.b }}
          {bumpSide}
        />
      {/if}

      {#if session && paused}
        <PauseMenu onResume={() => session?.resume()} onQuit={quit} />
      {/if}

      {#if session && result}
        <GameOver
          {result}
          {mode}
          {panel}
          onPlayAgain={() => startMatch(mode)}
          onMenu={quit}
        />
      {/if}

      {#if session && helpMode && !helpCard}
        <p class="oo__hint oo__hint--armed">{t.helpHint}</p>
      {/if}

      {#if session && helpCard}
        <HelpSheet
          card={helpCard}
          sheet={helpSheet}
          onClose={() => session?.closeHelp()}
        />
      {/if}

      {#if session && choice}
        <ChoicePrompt
          {choice}
          onPick={(i) => choice?.pick(i)}
          onCancel={() => choice?.cancel()}
        />
      {/if}
    </div>
  {/if}

  <!-- Screen space, not camera anchored, so the demo canvas renders sharp. -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={FULL_STACK_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}

  {#if loadError}
    <div class="oo__center"><p class="oo__hint">{loadError}</p></div>
  {/if}
</div>

<style lang="sass">
  .oo
    position: absolute
    inset: 0
    pointer-events: none

  .oo__ui
    pointer-events: none

  .oo__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center

  .oo__hint
    color: var(--color-text)

  // Armed with nothing chosen, the board is undimmed and nothing on it has
  // changed, so the one cue that taps mean something else has to be words.
  .oo__hint--armed
    position: absolute
    top: var(--space-16)
    left: 50%
    transform: translateX(-50%)
    margin: 0
    padding: var(--space-8) var(--space-16)
    border-radius: var(--radius-pill)
    background: var(--color-surface-card)
    box-shadow: var(--color-shadow-card)
    @include tint.type-class(ui-small-bold)

</style>
