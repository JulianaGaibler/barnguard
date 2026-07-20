<script lang="ts">
  import { tick } from 'svelte'
  import {
    mountEngine,
    easings,
    ignoreAbort,
    SceneNode,
    domAnchor,
    type EngineHost,
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
    updateLayout,
    layout,
    REGION_WIDTH,
    REGION_HEIGHT,
  } from './world'
  import Launcher from './launcher/Launcher.svelte'
  import ReturnToLauncherOverlay from './ReturnToLauncherOverlay.svelte'
  import { themeScope } from '@src/core/ui/themeScope'
  import type { GameModule } from './games/GameModule'

  type Screen = 'launcher' | 'transitioning' | 'ingame'

  let host = $state<EngineHost | null>(null)
  let background: BackgroundController | null = null
  let offResize: (() => void) | null = null
  let loadError = $state<string | null>(null)
  let screen = $state<Screen>('launcher')
  let activeGame = $state<GameModule | null>(null)
  // Node the launcher UI is pinned to, at the launcher region's origin. The
  // launcher rides the camera, so a pan slides it on/off screen instead of the
  // old fade-out-then-move; `cull` hides it once it's fully off the canvas.
  let launcherAnchor = $state<SceneNode | null>(null)

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
      // Size the region gap to the current canvas, and keep it adaptive: on
      // resize the launcher region re-flows so a narrower screen never bleeds
      // one region's content into the other's view.
      const px = h.engine.renderer.pixelSize
      updateLayout(px.w, px.h)
      h.engine.camera.setViewport(launcherView())
      // A region-sized node at the launcher region's origin; the launcher UI
      // attaches to it. Its Y follows `layout.launcherTop` so it stays aligned
      // as the region gap re-flows on resize.
      const anchor = new SceneNode('launcher-ui-anchor')
      anchor.transform.y = layout.launcherTop
      anchor.debugBounds = {
        x: 0,
        y: 0,
        width: REGION_WIDTH,
        height: REGION_HEIGHT,
      }
      h.engine.scene.root.add(anchor)
      launcherAnchor = anchor
      offResize = h.engine.events.on('resize', (e) => {
        updateLayout(e.pixel.w, e.pixel.h)
        anchor.transform.y = layout.launcherTop
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
        dynamicResolution: { enabled: true },
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
  {#if host && launcherAnchor}
    <div
      class="arcade__ui"
      use:domAnchor={{
        engine: host.engine,
        node: launcherAnchor,
        size: { width: REGION_WIDTH, height: REGION_HEIGHT },
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
      <Game {host} onExit={exit} />
    </div>
  {/if}

  <!--
    Permanent escape hatch: swipe down from the top while a game is mounted to
    reveal a "Return to Launcher" pill with an inline confirm step.
  -->
  <ReturnToLauncherOverlay active={!!activeGame} onConfirm={exit} />
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
