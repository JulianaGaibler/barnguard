<script lang="ts">
  import { onMount } from 'svelte'
  import { Node2D, domAnchor, type Rect } from '@src/stargazer'
  import { gameVisibleRect, REGION_HEIGHT, REGION_WIDTH } from '../../world'
  import type { GameProps } from '../GameModule'
  import {
    startGame,
    type ChoicePrompt as ChoicePromptData,
    type GameMode,
    type GameOverView,
    type GameSession,
  } from './game'
  import { OO_STRINGS as t } from './strings'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import PauseMenu from './overlays/PauseMenu.svelte'
  import GameOver from './overlays/GameOver.svelte'
  import ChoicePrompt from './overlays/ChoicePrompt.svelte'

  // Overlays ride the camera via `domAnchor`, so there is no fade gate.
  const { host, onExit }: GameProps = $props()

  let session = $state<GameSession | null>(null)
  let loadError = $state<string | null>(null)
  let showSplash = $state(true)
  let paused = $state(false)
  let mode = $state<GameMode>({ kind: 'versus' })
  let result = $state<GameOverView | null>(null)
  let choice = $state<ChoicePromptData | null>(null)
  let turn = $state<0 | 1>(0)
  let thinking = $state(false)
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
    const view = gameVisibleRect(px.w, px.h)

    const uiAnchor = new Node2D('office-overtime-ui-anchor')
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
        sess.events.on('matchStarted', (p) => {
          mode = p.mode
          result = null
          showSplash = false
        })
        sess.events.on('turnChanged', (p) => {
          turn = p.turn
          thinking = p.thinking
        })
        sess.events.on('gameOver', (p) => {
          result = p
        })
        sess.events.on('choice', (p) => {
          choice = p
        })
        sess.events.on('reset', () => {
          paused = false
          result = null
          showSplash = true
        })
        sess.events.on('paused', () => (paused = true))
        sess.events.on('resumed', () => (paused = false))
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

  const startMatch = (m: GameMode): void => session?.startMatch(m)
  const quit = (): void => session?.reset()

  const turnLabel = $derived(
    thinking ? t.thinking : turn === 0 ? t.yourTurn : t.theirTurn,
  )
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
        <SplashScreen onStart={startMatch} {onExit} />
      {/if}

      {#if session && !showSplash && !result}
        <div class="oo__hud">
          <span class="oo__turn">{turnLabel}</span>
        </div>
      {/if}

      {#if session && paused}
        <PauseMenu onResume={() => session?.resume()} onQuit={quit} />
      {/if}

      {#if session && result}
        <GameOver
          {result}
          {mode}
          onPlayAgain={() => startMatch(mode)}
          onMenu={quit}
        />
      {/if}

      {#if session && choice}
        <ChoicePrompt {choice} onPick={(i) => choice?.pick(i)} />
      {/if}
    </div>
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

  .oo__hud
    position: absolute
    top: var(--space-16)
    left: 50%
    transform: translateX(-50%)
    display: flex
    gap: var(--space-16)
    align-items: baseline

  .oo__turn
    @include tint.type-class(card-title)
    color: var(--color-title)
</style>
