<script lang="ts">
  /**
   * The display's root: one canvas for the splash animation and whatever the
   * engine draws later, with the screens' HTML over it in the 1920 by 1080
   * design frame. Switches between the splash and the story, and returns to the
   * splash when a visitor walks off.
   */
  import { onDestroy, onMount } from 'svelte'
  import {
    domAnchor,
    Layer,
    mountEngine,
    Node2D,
    type EngineHost,
  } from '@src/stargazer'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import { msSinceInput, pokeActivity } from '@src/core/activity'
  import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
  import UiLayer from '@src/core/ui/UiLayer.svelte'
  import IdleNotice from '@src/core/ui/IdleNotice.svelte'
  import { t } from '../i18n'
  import { PALETTE } from '../theme'
  import { IDLE_POLL_MS, IDLE_WARN_MS, isExpired, isWarning } from '../idle'
  import { story } from '../story/story'
  import { Run } from '../story/run'
  import { runFromQuery } from '../story/devJump'
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
    console.warn('[age-verification] WebGPU device lost, remounting on WebGL2')
    forcedBackend = 'webgl2'
    canvasKey++
  }

  let host = $state.raw<EngineHost | null>(null)
  let uiLayer = $state.raw<Layer | null>(null)
  /** The design frame's top left, which the screens' HTML pins to. */
  let frameNode = $state.raw<Node2D | null>(null)
  let offFontChange: (() => void) | null = null

  // In development, `?node=` opens the story at any screen.
  const jump = import.meta.env.DEV
    ? runFromQuery(story, window.location.search)
    : null
  // The jump applies to the first run only. Every later run starts fresh.
  let start = $state.raw<Run>(jump ?? new Run(story))
  let view = $state<'splash' | 'story'>(jump ? 'story' : 'splash')

  function goHome(): void {
    view = 'splash'
    start = new Run(story)
  }

  function onEngineReady(h: EngineHost): void {
    offFontChange = invalidateTextOnFontLoad(h.engine)
    const ui = new Layer({
      id: 'ui',
      space: {
        frame: { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
      },
    })
    h.engine.tree.root.add(ui)
    const node = new Node2D('design-frame')
    ui.add(node)
    uiLayer = ui
    frameNode = node
    host = h
    h.start()
  }

  function onEngineDestroy(): void {
    offFontChange?.()
    offFontChange = null
    frameNode = null
    uiLayer = null
    host = null
  }

  let idleWarning = $state(false)

  onMount(() => {
    const timer = setInterval(() => {
      const idleMs = msSinceInput()
      idleWarning = view === 'story' && isWarning(idleMs)
      if (view === 'story' && isExpired(idleMs)) {
        pokeActivity()
        goHome()
      }
    }, IDLE_POLL_MS)
    return () => clearInterval(timer)
  })

  onDestroy(() => offFontChange?.())
</script>

<main class="av">
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

    {#if host && uiLayer && frameNode}
      <UiLayer engine={host.engine} layer={uiLayer}>
        <div
          class="av__frame"
          use:domAnchor={{
            engine: host!.engine,
            node: frameNode!,
            size: { width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
          }}
        >
          <SplashScreen
            engine={host!.engine}
            layer={uiLayer!}
            active={view === 'splash'}
            onStart={() => (view = 'story')}
          />
          <StoryScreen
            engine={host!.engine}
            {start}
            active={view === 'story'}
            onHome={goHome}
          />
        </div>
      </UiLayer>
    {/if}
  {/key}

  <IdleNotice
    visible={idleWarning}
    message={$t.story.idleReturning}
    durationMs={IDLE_WARN_MS}
  />
</main>

<style lang="sass">
  .av
    position: relative
    width: 100%
    height: 100%
    overflow: hidden
    background: var(--color-surface)

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

  .av__frame
    position: absolute
    inset-block-start: 0
    inset-inline-start: 0
    user-select: none
    -webkit-user-select: none
</style>
