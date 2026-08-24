<script lang="ts">
  import { tick } from 'svelte'
  import {
    mountEngine,
    easings,
    ignoreAbort,
    Node2D,
    CameraNode2D,
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
  import { browseState } from './launcher/browseState.svelte'
  import ReturnToLauncherOverlay from './ReturnToLauncherOverlay.svelte'
  import IdleNotice from './IdleNotice.svelte'
  import { IDLE_POLL_MS, isExpired, isWarning } from './idle'
  import { runExitTasks } from './exitTasks'
  import { msSinceInput, pokeActivity } from '@src/core/activity'
  import { fontScope, themeScope } from '@src/core/ui/themeScope'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import { applyTheme } from '@src/core/theme'
  import { daemonConfig } from '@src/stores/daemonConfig'
  import { arcadeNightPalette, arcadeTheme } from './theme'
  import { rgbaStr } from './background/palette'
  import {
    DAY_CYCLE,
    effectiveElevationDeg,
    locationFromConfig,
    paletteAt,
    zonedMinutesToEpochMs,
    zonedWallClockToEpochMs,
  } from './background/dayCycle'
  import { skyIsDark, skyTimeOverride, skyTopColor } from './uiState'
  import type { GameModule } from './games/GameModule'
  import { ArcadeCamera } from './games/arcadeCamera'
  import { ArcadeBackdrop } from './games/arcadeBackdrop'
  import { GameRegion } from './games/gameRegion.svelte'
  import { DemoStage } from './tutorial/DemoStage'
  import { tutorialOpen } from './uiState'
  import { get } from 'svelte/store'

  type Screen = 'launcher' | 'transitioning' | 'ingame'
  type Gfx = 'webgpu' | 'webgl2' | 'auto'

  // Backend selection + WebGPU-loss recovery. The `?gfx` URL param seeds the
  // choice. A lost WebGPU device can't reuse its canvas, so recovery bumps
  // `canvasKey` (re-keying the `<canvas>` so `mountEngine` rebuilds on a fresh
  // node) and forces WebGL2 for the remount.
  function urlBackend(): Gfx {
    const g = new URLSearchParams(location.search).get('gfx')
    return g === 'webgpu' || g === 'webgl2' ? g : 'auto'
  }
  let forcedBackend = $state<'webgl2' | null>(null)
  let canvasKey = $state(0)
  const backend = $derived<Gfx>(forcedBackend ?? urlBackend())

  function onBackendLost(): void {
    console.warn('[arcade] WebGPU device lost, remounting on WebGL2')
    forcedBackend = 'webgl2'
    canvasKey++
  }

  // Pin the sky at a point in the cycle for a look you would otherwise have to
  // wait for. `?sun=<deg>` sets the driver straight, `?time=HH:MM` and
  // `?date=MM-DD` name a wall clock in the booth's own zone, which is what makes
  // a preview mean the same thing from any timezone. Null leaves it on the sun.
  function urlSunOverride(): number | null {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(location.search)
    const sun = params.get('sun')
    if (sun !== null) {
      const deg = Number(sun)
      return Number.isFinite(deg) ? deg : null
    }
    const time = params.get('time')
    const date = params.get('date')
    if (time === null && date === null) return null
    const where = locationFromConfig(get(daemonConfig))
    const now = new Date()
    const [month, day] = date
      ? date.split('-').map(Number)
      : [now.getMonth() + 1, now.getDate()]
    const [hour, minute] = time ? time.split(':').map(Number) : [12, 0]
    if (![month, day, hour, minute].every(Number.isFinite)) return null
    const at = zonedWallClockToEpochMs(
      now.getFullYear(),
      month,
      day,
      hour,
      minute,
      where.timeZone,
    )
    return effectiveElevationDeg(at, where)
  }

  const urlOverrideDeg = urlSunOverride()

  // The clear color shows for the one frame before the gradient paints, so it
  // reads the palette the cycle is about to draw rather than a fixed sunset.
  const initialSky = rgbaStr(
    paletteAt(
      urlOverrideDeg ??
        effectiveElevationDeg(Date.now(), DAY_CYCLE.fallbackLocation),
    ).skyTop,
  )

  let host = $state<EngineHost | null>(null)
  // The one 2D camera for the arcade, created explicitly on engine-ready.
  let camera: CameraNode2D | null = null
  let background: BackgroundController | null = null
  // One pre-warmed, arcade-owned demo stage shared by every game's tutorial.
  // Created at boot behind the loading screen so its WebGL2 context init never
  // stalls a tap. `null` if the backend can't provide one.
  let demoStage = $state<DemoStage | null>(null)
  let offResize: (() => void) | null = null
  let offFontChange: (() => void) | null = null
  let loadError = $state<string | null>(null)
  let screen = $state<Screen>('launcher')
  let activeGame = $state<GameModule | null>(null)
  // A camera lease handed to the active game so it can frame sub-rects of the
  // game region (e.g. a zoom) without owning the shared camera. Created on
  // Play, released on exit so a mid-zoom game can't fight the pan back.
  let gameCamera = $state<ArcadeCamera | null>(null)
  let gameBackdrop = $state<ArcadeBackdrop | null>(null)
  // The game region's anchor, rect and booth-corner inset, created once and
  // handed to every game so none of them recompute it. Long-lived: the anchor
  // sits in the tree with nothing pinned to it while the launcher is up.
  let gameRegion = $state<GameRegion | null>(null)
  // Node the launcher UI is pinned to, at the launcher region's origin. The
  // launcher rides the camera, so a pan slides it on/off screen instead of the
  // old fade-out-then-move, `cull` hides it once it's fully off the canvas.
  let launcherAnchor = $state<Node2D | null>(null)
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
  // The mounted launcher, so an idle booth can be put back the way it opens.
  let launcher = $state<ReturnType<typeof Launcher> | null>(null)
  // True for the countdown that precedes an idle reset, in-game only. On the
  // launcher there is nothing to lose, so the reset happens without warning.
  let idleWarning = $state(false)

  const CAMERA_SEC = 0.7

  function panCamera(view: ReturnType<typeof gameView>): Promise<void> {
    if (!camera) return Promise.resolve()
    return camera
      .animateTo(view, { duration: CAMERA_SEC, easing: easings.inOutCubic })
      .catch(ignoreAbort)
  }

  async function onEngineReady(h: EngineHost): Promise<void> {
    try {
      const bg = new BackgroundController(h, urlOverrideDeg)
      await bg.build()
      background = bg
      host = h
      offFontChange = invalidateTextOnFontLoad(h.engine)
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
      // Explicitly create the arcade's 2D camera and make it current.
      const cam = new CameraNode2D('arcade-camera')
      cam.setViewport(launcherView())
      h.engine.tree.root.add(cam)
      cam.makeCurrent()
      camera = cam
      gameRegion = new GameRegion(h.engine)
      // A node at the launcher visible rect's top-left. The launcher UI attaches
      // to it and covers the whole visible area. Its position + the overlay size
      // are re-fit on resize so the menu tracks the window aspect.
      const anchor = new Node2D('launcher-ui-anchor')
      const lr = launcherVisibleRect(px.w, px.h)
      anchor.transform.x = lr.x
      anchor.transform.y = lr.y
      anchor.debugBounds = { x: 0, y: 0, width: lr.width, height: lr.height }
      h.engine.tree.root.add(anchor)
      launcherAnchor = anchor
      launcherRect = lr
      offResize = h.engine.events.on('resize', (e) => {
        updateLayout(e.pixel.w, e.pixel.h)
        // Re-fit the launcher overlay to the new visible rect (position + size).
        const lr = launcherVisibleRect(e.pixel.w, e.pixel.h)
        anchor.transform.x = lr.x
        anchor.transform.y = lr.y
        launcherRect = lr
        // Re-anchor whichever region is framed. In-game, a game that holds the
        // camera lease may have zoomed into a sub-rect, re-apply its current
        // framing rather than snapping back to the region's home framing.
        if (screen === 'launcher') {
          cam.setViewport(launcherView())
        } else if (screen === 'ingame') {
          cam.setViewport(gameCamera ? gameCamera.framing : gameView())
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
    offFontChange?.()
    offFontChange = null
    if (launcherAnchor && !launcherAnchor.isDestroyed) launcherAnchor.destroy()
    launcherAnchor = null
    gameRegion?.destroy()
    gameRegion = null
    demoStage?.destroy()
    demoStage = null
    background?.destroy()
    background = null
    camera = null
    host = null
  }

  async function play(game: GameModule): Promise<void> {
    if (!host || !camera || screen !== 'launcher') return
    screen = 'transitioning'
    // The launcher's filters and scroll outlive its component so a visitor
    // trying a game and coming straight back keeps their shortlist. Past a
    // minute in-game they are treated as gone and it clears itself.
    browseState.startExpiry()
    // Lease the shared camera to the game, scoped to the game region's home
    // framing. Games that don't zoom simply never touch it.
    gameCamera = new ArcadeCamera(camera, gameView())
    // Lease the shared background too. A 3D game takes it down once its own
    // menu covers the change, since the 3D pass draws under every 2D layer and
    // the sky would otherwise hide its scene outright.
    if (background) gameBackdrop = new ArcadeBackdrop(background)
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
  // reflect keyboard (Y) toggles back so the menu label stays in sync, the
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

  // The attendant slider wins over the URL, and releasing it falls back to
  // whatever the URL asked for, which is null on a booth. The slider names a
  // time on the booth clock, so it resolves against the booth's own location.
  $effect(() => {
    if (!host || !background) return
    const minutes = $skyTimeOverride
    if (minutes === null) {
      background.sunOverrideDeg = urlOverrideDeg
      return
    }
    const where = locationFromConfig($daemonConfig)
    background.sunOverrideDeg = effectiveElevationDeg(
      zonedMinutesToEpochMs(minutes, where.timeZone),
      where,
    )
  })

  // Mirror the sky into the DOM surfaces that are sky. Spreading `arcadeTheme`
  // keeps every other role present, since `applyPalette` only ever sets custom
  // properties and never removes one a previous theme left behind.
  $effect(() => {
    applyTheme({
      ...arcadeTheme,
      cover: { ...arcadeTheme.cover, backgroundColor: $skyTopColor },
    })
  })

  // Return the booth to its opening state once the visitor in front of it has
  // gone. In a game that means quitting, and `browseState` has already expired
  // by then, so the launcher comes back clean on its own. On the launcher the
  // component is up and holding that state, so it has to be reset in place.
  $effect(() => {
    const id = setInterval(() => {
      const idleMs = msSinceInput()
      idleWarning = isWarning(idleMs) && screen === 'ingame'
      if (!isExpired(idleMs) || screen === 'transitioning') return
      // Restart the clock so the next tick doesn't fire the same reset again.
      pokeActivity()
      if (screen === 'ingame') void exit()
      else launcher?.reset()
    }, IDLE_POLL_MS)
    return () => clearInterval(id)
  })

  async function exit(): Promise<void> {
    if (!host || screen !== 'ingame') return
    screen = 'transitioning'
    browseState.cancelExpiry()
    // A game may have paused the engine for its pause menu. Resume before the
    // pan. A paused engine skips the animation tick, so the camera tween would
    // never advance and the return would hang.
    host.engine.setPaused(false)
    // Reclaim the camera before panning: releasing settles any in-flight game
    // zoom and stops the game issuing new framing calls, so the pan to the
    // launcher can't be fought by a late zoom (e.g. a mid-zoom swipe-out).
    gameCamera?.release()
    // Restore the sky before the pan, so the launcher is never seen without it.
    gameBackdrop?.release()
    // A game-over card can be holding a name the player typed but never
    // confirmed with a button. Flush alongside the pan rather than after it, so
    // a slow daemon costs nothing anyone can see.
    const flushed = runExitTasks()
    // Pan back to the launcher: the game's overlays slide out and cull, the
    // launcher slides back in. Unmount the game (→ session.destroy()) only once
    // the camera has left the game region.
    await panCamera(launcherView())
    await flushed
    activeGame = null
    gameCamera = null
    gameBackdrop = null
    screen = 'launcher'
  }
</script>

<main class="arcade">
  {#key canvasKey}
    <canvas
      class="arcade__canvas"
      use:mountEngine={{
        backend,
        onBackendLost,
        options: {
          transparent: false,
          // Matches the sky base so the first frame (before the gradient paints)
          // doesn't flash the engine's default dark clear.
          clearColor: initialSky,
        },
        onReady: onEngineReady,
        onDestroy: onEngineDestroy,
      }}
    ></canvas>
  {/key}

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
      use:themeScope={$skyIsDark ? arcadeNightPalette : arcadeTheme.palette}
    >
      <Launcher bind:this={launcher} onPlay={play} />
    </div>
  {/if}

  {#if host && activeGame && gameCamera && gameBackdrop && gameRegion}
    {@const Game = activeGame.component}
    <!-- Layout-neutral wrapper carrying the game's scoped theme overrides. -->
    <div
      style="display: contents"
      use:themeScope={activeGame.meta.themeTokens}
      use:fontScope={activeGame.meta.fontTokens}
    >
      <Game
        {host}
        onExit={exit}
        {demoStage}
        camera={gameCamera}
        backdrop={gameBackdrop}
        region={gameRegion}
      />
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

  <IdleNotice visible={idleWarning} />
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
  // canvas still receives input, the launcher's cards opt back in.
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
