<script lang="ts">
  /**
   * The display's root: one canvas for the background, the pictures and the
   * splash animation, with the screens' HTML over it. The screens are laid out
   * in design pixels against the visible area, which is the 1920 by 1080 design
   * on a 16:9 window and larger on one axis on any other. Switches between the
   * splash and the story, and returns to the splash when a visitor walks off.
   * The attendant can also stop the story from the booth menu, which starts the
   * screens over even when one is stuck.
   */
  import { onDestroy, untrack } from 'svelte'
  import {
    CameraNode2D,
    ignoreAbort,
    Layer,
    mountEngine,
    type EngineHost,
  } from 'stargazer'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import {
    debugHudVisible,
    setDebugHudVisible,
  } from '@src/core/attendant/boothMenuToggle'
  import { stopGameHandle } from '@src/stores/gameSelection'
  import { DebugHud } from 'stargazer/debug-ui'
  import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
  import UiLayer from '@src/core/ui/UiLayer.svelte'
  import { PALETTE } from '../theme'
  import { story } from '../story/story'
  import { Run } from '../story/run'
  import { runAt, runFromQuery } from '../story/devJump'
  import { jumpRequest } from './jump'
  import { clearSavedRun, loadRun, saveRun } from '../story/saved'
  import { t } from '../i18n'
  import { createBackground, type Background } from './backgroundLayer'
  import { MOODS, type Mood } from './moods'
  import BackgroundFit from './BackgroundFit.svelte'
  import { MOTION, SPLASH_POSE } from './motion'
  import { IllustrationLayer } from './IllustrationLayer'
  import { FixedCells, splashDither } from './ditherLook'
  import { pickFrame } from './frame'
  import SplashScreen from './SplashScreen.svelte'
  import StoryScreen from './StoryScreen.svelte'

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
    console.warn('[policy-story] WebGPU device lost, remounting on WebGL2')
    forcedBackend = 'webgl2'
    canvasKey++
  }

  let host = $state.raw<EngineHost | null>(null)
  let uiLayer = $state.raw<Layer | null>(null)
  /** Holds the splash animation, dithered. */
  let mediaLayer = $state.raw<Layer | null>(null)
  let illustrations = $state.raw<IllustrationLayer | null>(null)
  /** The splash animation's dither cells, which keep their size on screen. */
  let splashCells = $state.raw<FixedCells | null>(null)
  let background = $state.raw<Background | null>(null)
  /** The black the ending fades the display to. */
  const curtain = $state({ v: 0 })
  /** The colors the screens read, as the background blends between moods. */
  let mood = $state.raw<Mood>(MOODS.booth)
  let offFontChange: (() => void) | null = null

  // In development, `?node=` opens the story at any screen.
  const jump = import.meta.env.DEV
    ? runFromQuery(story, window.location.search)
    : null
  // The jump applies to the first run only. Every later run starts fresh.
  // Otherwise the story carries on from the place the last visit reached.
  const saved = jump ? null : loadRun(story)
  let start = $state.raw<Run>(jump ?? saved ?? new Run(story))
  let view = $state<'splash' | 'story'>(jump || saved ? 'story' : 'splash')
  /** True when the story opened partway, which offers the way to start over. */
  let resumed = $state(!!saved)

  /** Saves the place, and drops the restart chip once the visitor moves on. */
  function onProgress(run: Run): void {
    saveRun(run)
    if (run.currentId !== start.currentId) resumed = false
  }

  function goHome(): void {
    view = 'splash'
    start = new Run(story)
    resumed = false
    clearSavedRun()
  }

  /** Bumped to remount the screens, which throws away whatever state they hold. */
  let screensKey = $state(0)

  /**
   * The attendant's "Stop game". Home, and more: the screens are built again
   * from nothing, so a transition that never finished, a button that stopped
   * answering or a half-faded picture cannot outlive it.
   */
  function stopStory(): void {
    // A paused engine runs no tweens, so the entrance of the new screens would
    // never play.
    host?.engine.setPaused(false)
    screensKey++
    goHome()
    void illustrations?.show(null)
  }

  // The booth menu's "Jump to section" opens the story at a screen. The screens
  // are built again, as for a stop, and then start from the run that gets there.
  $effect(() => {
    if (!host) return
    return jumpRequest.subscribe((request) => {
      if (!request) return
      const run = runAt(story, request.node, request.flags)
      if (!run) return
      host!.engine.setPaused(false)
      screensKey++
      start = run
      view = 'story'
      resumed = true
      void illustrations?.show(null)
    })
  })

  // The booth menu calls this. It is safe on the splash, where it only starts
  // the screens over.
  $effect(() => {
    if (!host) return
    stopGameHandle.set(stopStory)
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

  function onEngineReady(h: EngineHost): void {
    offFontChange = invalidateTextOnFontLoad(h.engine)
    const frame = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }
    // The engine draws nothing without a current camera. The layers carry their
    // own view of the frame, so this one only has to exist.
    const camera = new CameraNode2D('camera')
    camera.setViewport(frame)
    h.engine.tree.root.add(camera)
    camera.makeCurrent()
    // Back to front: the background, the art, then the UI the HTML hangs on.
    const backdrop = createBackground(h.engine, (next) => (mood = next))
    const splashFx = splashDither()
    const media = new Layer({
      id: 'splash-media',
      space: { frame: pickFrame },
      region: { x: 0, y: 0, width: 0, height: 0 },
      effects: [splashFx],
      persistent: true,
    })
    // Hidden until the animation is there, so an empty layer takes no surface.
    media.visible = false
    const art = new IllustrationLayer()
    const ui = new Layer({ id: 'ui', space: { frame: pickFrame } })
    for (const layer of [
      backdrop.layer,
      backdrop.accent,
      ...backdrop.decor,
      media,
      art.layer,
      ui,
    ]) {
      h.engine.tree.root.add(layer)
    }
    backdrop.layer.warm()
    backdrop.accent.warm()
    for (const layer of backdrop.decor) layer.warm()
    media.warm()
    art.layer.warm()
    uiLayer = ui
    splashCells = new FixedCells(splashFx)
    mediaLayer = media
    illustrations = art
    background = backdrop
    host = h
    h.start()
  }

  function onEngineDestroy(): void {
    offFontChange?.()
    offFontChange = null
    illustrations?.destroy()
    background = null
    uiLayer = null
    splashCells = null
    mediaLayer = null
    illustrations = null
    host = null
  }

  // The background rests in the splash's pose, and returns to it from the story.
  // The story moves it itself while it plays.
  $effect(() => {
    if (!background || view !== 'splash') return
    const pose = SPLASH_POSE
    untrack(() => {
      background!.to(pose, { swell: true })
      background!.setMood(undefined, { duration: MOTION.mood })
    })
  })

  // After the ending's fade the splash comes up out of the black.
  $effect(() => {
    if (!host || view !== 'splash' || curtain.v <= 0) return
    const engine = host.engine
    untrack(() => {
      void engine
        .tween(curtain, { v: 0 }, { duration: MOTION.fadeIn, key: 'curtain' })
        .catch(ignoreAbort)
    })
  })

  onDestroy(() => offFontChange?.())
</script>

<main
  class="av"
  style:--color-surface={mood.background}
  style:--color-text={mood.text}
  style:--color-accent={mood.action}
  style:--color-action-primary={mood.action}
  style:--color-action-primary-text={mood.actionText}
>
  {#key canvasKey}
    <canvas
      class="av__canvas"
      use:mountEngine={{
        backend,
        onBackendLost,
        options: { clearColor: PALETTE.white },
        onReady: onEngineReady,
        onDestroy: onEngineDestroy,
      }}
    ></canvas>

    {#if host && uiLayer && mediaLayer && illustrations && background}
      <UiLayer engine={host.engine} layer={uiLayer}>
        {#snippet children(region)}
          <BackgroundFit
            {region}
            background={background!}
            illustrations={illustrations!}
            cells={splashCells ? [splashCells] : []}
          />
          {#key screensKey}
            <SplashScreen
              engine={host!.engine}
              {region}
              layer={mediaLayer!}
              active={view === 'splash'}
              onStart={() => (view = 'story')}
            />
            <StoryScreen
              engine={host!.engine}
              {region}
              illustrations={illustrations!}
              backdrop={background}
              {start}
              active={view === 'story'}
              onHome={goHome}
              {onProgress}
              {curtain}
            />
          {/key}
        {/snippet}
      </UiLayer>
    {/if}
  {/key}

  {#if resumed && view === 'story'}
    <button type="button" class="av__chip" onclick={stopStory}>
      {$t.story.restart}
    </button>
  {/if}

  <div class="av__curtain" style:opacity={curtain.v}></div>
</main>

{#if host}
  <DebugHud debug={host.debug} />
{/if}

<style lang="sass">
  .av
    position: relative
    width: 100%
    height: 100%
    overflow: hidden
    background: var(--color-surface)

  // The way out of a resumed story, at the top where the progress row was.
  .av__chip
    position: absolute
    inset-block-start: max(16px, env(safe-area-inset-top))
    inset-inline-start: 50%
    transform: translateX(-50%)
    z-index: 5
    min-height: 40px
    padding: 8px 18px
    border: 1.5px solid var(--color-text)
    border-radius: 999px
    background: transparent
    color: var(--color-text)
    font-family: var(--font-mozilla-text)
    font-size: 15px
    font-weight: 600
    cursor: pointer
    -webkit-tap-highlight-color: transparent

    &:hover,
    &:focus-visible
      text-decoration: underline
      text-underline-offset: 0.22em

  // Black over everything, for the fade out at the end.
  .av__curtain
    position: absolute
    inset: 0
    z-index: 10
    background: #000
    pointer-events: none

  .av__canvas
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
