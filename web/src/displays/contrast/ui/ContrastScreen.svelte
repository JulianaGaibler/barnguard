<script lang="ts">
  /**
   * The display's root: one canvas that draws everything, with the screen
   * reader's hidden tree beside it. The scene (`Scene.ts`) does the drawing and
   * the choreography and the session (`game/session.ts`) holds the rules. This
   * component mounts the engine, builds both once it is ready, keeps the scene
   * fitted to the window, and wires the attendant's controls and the idle
   * reset.
   */
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import {
    a11yRoot,
    CameraNode2D,
    Layer,
    mountEngine,
    type EngineHost,
  } from 'stargazer'
  import { DebugHud } from 'stargazer/debug-ui'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import { msSinceInput, pokeActivity } from '@src/core/activity'
  import {
    debugHudVisible,
    setDebugHudVisible,
  } from '@src/core/attendant/boothMenuToggle'
  import { stopGameHandle } from '@src/stores/gameSelection'
  import { isInstalledApp } from '@src/core/pwa/installable'
  import IdleNotice from '@src/core/ui/IdleNotice.svelte'
  import { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { PALETTE } from '../theme'
  import { IDLE_POLL_MS, IDLE_WARN_MS, isExpired, isWarning } from '../idle'
  import { loadColors } from '../game/colors'
  import { algorithm } from '../game/settings'
  import { Session } from '../game/session'
  import { devJumpFrom, driveTo } from './devJump'
  import { pickFrame } from './frame'
  import { readSafeArea, scaleInsets } from './safeArea'
  import { Scene } from './Scene'

  type Gfx = 'webgpu' | 'webgl2' | 'auto'

  // A lost WebGPU device remounts the canvas on WebGL2.
  function urlBackend(): Gfx {
    const g = new URLSearchParams(location.search).get('gfx')
    return g === 'webgpu' || g === 'webgl2' ? g : 'auto'
  }
  let forcedBackend = $state<'webgl2' | null>(null)
  let canvasKey = $state(0)
  const backend = $derived<Gfx>(forcedBackend ?? urlBackend())

  function onBackendLost(): void {
    console.warn('[contrast] WebGPU device lost, remounting on WebGL2')
    forcedBackend = 'webgl2'
    canvasKey++
  }

  let host = $state.raw<EngineHost | null>(null)
  let session = $state.raw<Session | null>(null)
  let scene: Scene | null = null
  let region: UiRegion | null = null
  let offResize: (() => void) | null = null
  let offFontChange: (() => void) | null = null
  let offDrive: (() => void) | null = null
  /**
   * Counts mounts, so an engine that was torn down before it was ready is
   * dropped.
   */
  let mounts = 0

  // In development, `?screen=`, `?rounds=` and `?seed=` open a screen.
  const jump = import.meta.env.DEV ? devJumpFrom(location.search) : null

  /** The visible area's insets, in design pixels. */
  function insets() {
    return scaleInsets(readSafeArea(), region?.cssPxInWorld ?? 1)
  }

  async function onEngineReady(h: EngineHost): Promise<void> {
    const mount = ++mounts
    offFontChange = invalidateTextOnFontLoad(h.engine)
    // The engine draws nothing without a current camera. The layer carries its
    // own view of the frame, so this one only has to exist.
    const camera = new CameraNode2D('camera')
    camera.setViewport({ x: 0, y: 0, width: 1440, height: 1080 })
    h.engine.tree.root.add(camera)
    camera.makeCurrent()
    const layer = new Layer({ id: 'contrast', space: { frame: pickFrame } })
    h.engine.tree.root.add(layer)
    region = new UiRegion(h.engine, layer)

    const colors = await loadColors()
    if (mount !== mounts) return
    const next = new Session({
      algorithm: get(algorithm),
      colors,
      random: jump?.random,
    })
    const built = new Scene({
      engine: h.engine,
      parent: region.anchor,
      session: next,
      messages: get(t),
      size: region.rect,
      insets: insets(),
      colors,
    })
    offResize = region.onResize((rect) => built.resize(rect, insets()))
    scene = built
    session = next
    host = h
    built.showSplash()
    h.start()
    if (jump) offDrive = driveTo(next, jump)
  }

  function onEngineDestroy(): void {
    mounts++
    offFontChange?.()
    offDrive?.()
    offResize?.()
    scene?.destroy()
    region?.destroy()
    offFontChange = offDrive = offResize = null
    scene = null
    region = null
    session = null
    host = null
  }

  /**
   * The attendant's "Stop game". Back to the splash from anywhere, and the
   * screen is built from the start even if a sequence got stuck.
   */
  function stopGame(): void {
    host?.engine.setPaused(false)
    pokeActivity()
    if (session && session.phase !== 'splash') session.reset()
    else scene?.showSplash()
    idleWarning = false
  }

  $effect(() => {
    if (!host) return
    stopGameHandle.set(stopGame)
    return () => stopGameHandle.set(null)
  })

  // The booth menu's Stargazer toggle drives the engine's debug controller,
  // and a keyboard toggle (Y) is reflected back so the menu stays in step.
  $effect(() => {
    if (!host) return
    host.debug.setHudVisible($debugHudVisible)
  })
  $effect(() => {
    if (!host) return
    return host.debug.events.on('toggle', ({ hud }) => {
      if (hud !== $debugHudVisible) setDebugHudVisible(hud)
    })
  })

  // A new algorithm from the attendant ends the game in progress.
  $effect(() => {
    const next = $algorithm
    if (session && session.algorithm !== next) session.setAlgorithm(next)
  })

  let idleWarning = $state(false)
  /** Installed, the page sits below the status bar and shows rounded corners. */
  const installedApp = isInstalledApp()

  onMount(() => {
    // The page behind the canvas is ink too, so no light edge shows if the
    // screen is a few pixels taller than the page, as an installed iPad app
    // can be.
    const root = document.documentElement
    const before = root.style.backgroundColor
    root.style.backgroundColor = PALETTE.ink
    const timer = setInterval(() => {
      if (!session || session.phase === 'splash') {
        idleWarning = false
        return
      }
      const idleMs = msSinceInput()
      idleWarning = isWarning(idleMs)
      if (isExpired(idleMs)) {
        pokeActivity()
        idleWarning = false
        session.reset()
      }
    }, IDLE_POLL_MS)
    return () => {
      clearInterval(timer)
      root.style.backgroundColor = before
    }
  })

  onDestroy(() => onEngineDestroy())
</script>

<main class="ct">
  {#key canvasKey}
    <canvas
      class="ct__canvas"
      use:mountEngine={{
        backend,
        onBackendLost,
        options: { clearColor: PALETTE.ink },
        onReady: onEngineReady,
        onDestroy: onEngineDestroy,
      }}
    ></canvas>
    {#if host}
      <div use:a11yRoot={{ engine: host.engine }}></div>
    {/if}
  {/key}

  {#if installedApp}
    <div class="ct__corner ct__corner--left" aria-hidden="true"></div>
    <div class="ct__corner ct__corner--right" aria-hidden="true"></div>
  {/if}

  <IdleNotice
    --idle-notice-bg={PALETTE.white}
    --idle-notice-color={PALETTE.ink}
    --idle-notice-track="rgba(22, 22, 22, 0.15)"
    visible={idleWarning}
    message={$t.gameOver.idleReturning}
    durationMs={IDLE_WARN_MS}
  />
</main>

{#if host}
  <DebugHud debug={host.debug} />
{/if}

<style lang="sass">
  // Fixed to the screen, not sized by the page, which an installed iPad app
  // can leave a line short at the bottom.
  .ct
    position: fixed
    inset: 0
    overflow: hidden
    background: var(--color-surface)

  // The status bar shows the page's own ink color, so the screen under it gets
  // inverted corners that make it look like a rounded rectangle set into the
  // bar. Their color has to be the bar's, which is the page's surface color.
  .ct__corner
    --corner: 28px
    position: absolute
    top: 0
    width: var(--corner)
    height: var(--corner)
    pointer-events: none
    z-index: 1

  .ct__corner--left
    left: 0
    background: radial-gradient(circle at 100% 100%, transparent calc(var(--corner) - 0.5px), var(--color-surface) var(--corner))

  .ct__corner--right
    right: 0
    background: radial-gradient(circle at 0 100%, transparent calc(var(--corner) - 0.5px), var(--color-surface) var(--corner))

  .ct__canvas
    position: absolute
    inset: 0
    display: block
    width: 100%
    height: 100%
    touch-action: none
    user-select: none
    -webkit-user-select: none
    outline: none
</style>
