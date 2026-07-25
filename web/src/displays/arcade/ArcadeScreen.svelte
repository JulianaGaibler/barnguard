<script lang="ts">
  import { tick } from 'svelte'
  import {
    mountEngine,
    easings,
    ignoreAbort,
    SceneNode,
    domAnchor,
    type EngineHost,
    type Rect,
  } from '@src/stargazer'
  import DebugHud from '@src/stargazer/debug/DebugHud.svelte'
  import {
    debugHudVisible,
    setDebugHudVisible,
  } from '@src/core/attendant/boothMenuToggle'
  import { BackgroundController } from './background/BackgroundController'
  import {
    gameView,
    launcherView,
    launcherVisibleRect,
    updateLayout,
    layout,
    REGION_WIDTH,
    REGION_HEIGHT,
  } from './world'
  import Launcher from './launcher/Launcher.svelte'
  import ReturnToLauncherOverlay from './ReturnToLauncherOverlay.svelte'
  import { themeScope } from '@src/core/ui/themeScope'
  import type { GameModule } from './games/GameModule'
  import { DemoStage } from './tutorial/DemoStage'
  import { tutorialOpen } from './uiState'

  type Screen = 'launcher' | 'transitioning' | 'ingame'

  let host = $state<EngineHost | null>(null)
  let background: BackgroundController | null = null
  // One pre-warmed, arcade-owned demo stage shared by every game's tutorial.
  // Created at boot behind the loading screen so its WebGL2 context init never
  // stalls a tap. `null` if the backend can't provide one.
  let demoStage = $state<DemoStage | null>(null)
  let offResize: (() => void) | null = null
  let loadError = $state<string | null>(null)
  let screen = $state<Screen>('launcher')
  let activeGame = $state<GameModule | null>(null)
  // Node the launcher UI is pinned to, at the launcher region's origin. The
  // launcher rides the camera, so a pan slides it on/off screen instead of the
  // old fade-out-then-move; `cull` hides it once it's fully off the canvas.
  let launcherAnchor = $state<SceneNode | null>(null)
  // The launcher overlay is sized to the launcher region's VISIBLE rect (the
  // full canvas area, adopting its aspect) rather than a fixed 1920×1080 box, so
  // the menu uses the whole window and reflows on resize instead of scaling a
  // letterboxed 16:9 panel. Recomputed on resize.
  let launcherRect = $state<Rect>({
    x: 0,
    y: layout.launcherTop,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  const CAMERA_SEC = 0.7

  function panCamera(view: ReturnType<typeof gameView>): Promise<void> {
    if (!host) return Promise.resolve()
    return host.engine.camera
      .animateTo(view, { duration: CAMERA_SEC, easing: easings.inOutCubic })
      .catch(ignoreAbort)
  }

  async function onEngineReady(h: EngineHost): Promise<void> {
    try {
      const bg = new BackgroundController(h)
      await bg.build()
      background = bg
      host = h
      // Pre-warm the tutorial demo stage while the loading screen is still up.
      try {
        demoStage = new DemoStage(h)
      } catch (err) {
        console.error('[arcade] demo stage init failed:', err)
        demoStage = null
      }
      // Size the region gap to the current canvas, and keep it adaptive: on
      // resize the launcher region re-flows so a narrower screen never bleeds
      // one region's content into the other's view.
      const px = h.engine.renderer.pixelSize
      updateLayout(px.w, px.h)
      h.engine.camera.setViewport(launcherView())
      // A node at the launcher visible rect's top-left; the launcher UI attaches
      // to it and covers the whole visible area. Its position + the overlay size
      // are re-fit on resize so the menu tracks the window aspect.
      const anchor = new SceneNode('launcher-ui-anchor')
      const lr = launcherVisibleRect(px.w, px.h)
      anchor.transform.x = lr.x
      anchor.transform.y = lr.y
      anchor.debugBounds = { x: 0, y: 0, width: lr.width, height: lr.height }
      h.engine.scene.root.add(anchor)
      launcherAnchor = anchor
      launcherRect = lr
      offResize = h.engine.events.on('resize', (e) => {
        updateLayout(e.pixel.w, e.pixel.h)
        // Re-fit the launcher overlay to the new visible rect (position + size).
        const lr = launcherVisibleRect(e.pixel.w, e.pixel.h)
        anchor.transform.x = lr.x
        anchor.transform.y = lr.y
        launcherRect = lr
        // Re-anchor whichever region is framed (the game framing is fixed).
        if (screen === 'launcher') {
          h.engine.camera.setViewport(launcherView())
        } else if (screen === 'ingame') {
          h.engine.camera.setViewport(gameView())
        }
      })
      h.start()
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  function onEngineDestroy(): void {
    offResize?.()
    offResize = null
    if (launcherAnchor && !launcherAnchor.isDestroyed) launcherAnchor.destroy()
    launcherAnchor = null
    demoStage?.destroy()
    demoStage = null
    background?.destroy()
    background = null
    host = null
  }

  async function play(game: GameModule): Promise<void> {
    if (!host || screen !== 'launcher') return
    screen = 'transitioning'
    // Mount the game first: its overlays attach to the game region, off-screen
    // (culled) while the camera is still on the launcher.
    activeGame = game
    await tick()
    // Pan to the game region. Both surfaces ride the camera - the launcher
    // slides out and culls off-screen, the game's overlays slide in.
    await panCamera(gameView())
    screen = 'ingame'
  }

  // Mirror the booth-menu debug toggle into the engine's debug controller, and
  // reflect keyboard (Y) toggles back so the menu label stays in sync — the
  // same two-way wiring stallwaechter uses.
  $effect(() => {
    if (!host) return
    host.debug.setHudVisible($debugHudVisible)
  })
  $effect(() => {
    if (!host) return
    const off = host.debug.events.on('toggle', ({ hud }) => {
      if (hud !== $debugHudVisible) setDebugHudVisible(hud)
    })
    return off
  })

  async function exit(): Promise<void> {
    if (!host || screen !== 'ingame') return
    screen = 'transitioning'
    // A game may have paused the engine for its pause menu. Resume before the
    // pan — a paused engine skips the animation tick, so the camera tween would
    // never advance and the return would hang.
    host.engine.setPaused(false)
    // Pan back to the launcher: the game's overlays slide out and cull, the
    // launcher slides back in. Unmount the game (→ session.destroy()) only once
    // the camera has left the game region.
    await panCamera(launcherView())
    activeGame = null
    screen = 'launcher'
  }
</script>

<main class="arcade">
  <canvas
    class="arcade__canvas"
    use:mountEngine={{
      options: {
        transparent: false,
        // Matches the sky base so the first frame (before the gradient paints)
        // doesn't flash the engine's default dark clear.
        clearColor: '#eac6f2',
        initialViewport: launcherView(),
      },
      onReady: onEngineReady,
      onDestroy: onEngineDestroy,
    }}
  ></canvas>

  {#if loadError}
    <div class="arcade__center"><p class="arcade__hint">{loadError}</p></div>
  {/if}

  <!--
    The launcher stays mounted and is pinned to the launcher region via
    `domAnchor`, so it rides the camera: a pan slides it off screen (and `cull`
    hides it there) rather than fading it first. Games mount only while active
    and pin their own overlays to the game region the same way.
  -->
  {#if host && launcherAnchor && screen !== 'ingame'}
    <div
      class="arcade__ui"
      use:domAnchor={{
        engine: host.engine,
        node: launcherAnchor,
        size: { width: launcherRect.width, height: launcherRect.height },
        cull: true,
      }}
    >
      <Launcher onPlay={play} />
    </div>
  {/if}

  {#if host && activeGame}
    {@const Game = activeGame.component}
    <!-- Layout-neutral wrapper carrying the game's scoped theme overrides. -->
    <div style="display: contents" use:themeScope={activeGame.meta.themeTokens}>
      <Game {host} onExit={exit} {demoStage} />
    </div>
  {/if}

  <!--
    Permanent escape hatch: swipe down from the top while a game is mounted to
    reveal a "Return to Launcher" pill with an inline confirm step. Suspended
    while a tutorial modal is open so a downward drift in the carousel can't
    trip it.
  -->
  <ReturnToLauncherOverlay
    active={!!activeGame && !$tutorialOpen}
    onConfirm={exit}
  />
</main>

{#if host}
  <DebugHud debug={host.debug} />
{/if}

<style lang="sass">
  .arcade
    position: relative
    height: 100%
    width: 100%
    overflow: hidden

  .arcade__canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    touch-action: none
    user-select: none
    -webkit-user-select: none
    outline: none
    image-rendering: auto

  // Region-pinned UI wrapper (positioned by `domAnchor`). Click-through so the
  // canvas still receives input; the launcher's cards opt back in.
  .arcade__ui
    pointer-events: none

  .arcade__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    pointer-events: none

  .arcade__hint
    color: var(--color-text)
</style>
