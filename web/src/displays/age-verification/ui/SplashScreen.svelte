<!--
  The first screen: the title and a button to begin, beside the splash
  animation, or under it on a portrait screen. The animation plays on a dark
  panel with a stepped edge, laid out by `splashLayoutIn`. The panel is a
  stargazer node on a layer of its own, under the HTML. The layout reaches the
  markup through `style:` directives. A `style` attribute would erase the inline
  transform and size that `domAnchor` writes whenever it changed.
-->
<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import {
    domAnchor,
    GfxPath,
    LottieNode,
    Node2D,
    ShapeNode,
    ignoreAbort,
    loadLottie,
    type Engine,
    type Layer,
  } from 'stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { LOGOS_URL, SPLASH_ANIMATION_URL } from '../assets'
  import { PALETTE } from '../theme'
  import { fitText, textRange } from './fitText'
  import { inWorld, MIN_TAP_CSS_PX } from './layout'
  import { MOTION, slideOffset } from './motion'
  import { splashLayoutIn } from './splashLayout'
  import { splashPlayback } from './splashPlayback'

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** The layer the panel goes on. */
    layer: Layer
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    onStart: () => void
  }
  const { engine, region, layer, active, onStart }: Props = $props()

  const layout = $derived(splashLayoutIn(region))
  const panelBox = $derived(inWorld(layout.panel, region.rect))

  // The engine and layer are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 4)
  let destroyed = false

  // The panel is dark until the animation is there, and stays dark if it never
  // comes. The outline clips both.
  const outline = new GfxPath()
  const panel = new Node2D('splash-panel')
  panel.clip = outline
  panel.transform.alpha = 0
  const backing = new ShapeNode({
    id: 'splash-backing',
    geometry: { kind: 'rect', width: 1, height: 1, centered: false },
    fill: PALETTE.black,
  })
  panel.add(backing)
  /* svelte-ignore state_referenced_locally */
  layer.add(panel)
  let animation = $state.raw<LottieNode | null>(null)

  if (SPLASH_ANIMATION_URL) {
    loadLottie(SPLASH_ANIMATION_URL)
      .then((parsed) => {
        if (destroyed) return
        const node = new LottieNode({
          id: 'splash-animation',
          animation: parsed,
          width: layout.panel.width,
          height: layout.panel.height,
          fit: 'cover',
          autoplay: false,
        })
        // Held still, it comes up at the frame it was left at.
        const held = get(splashPlayback)
        if (held.paused) node.seek(held.frame)
        panel.add(node)
        animation = node
      })
      .catch((error: unknown) => {
        console.warn(
          '[age-verification] splash animation failed to load',
          error,
        )
      })
  }

  // The title takes the largest size at which the column holds it, its lines
  // unbroken, and the button is set in proportion.
  /** How far the title may shrink to fit a narrow column, past body text. */
  const MIN_SHARE = 0.6
  let column = $state<HTMLElement | null>(null)
  let title = $state<HTMLElement | null>(null)
  function fit(): void {
    if (!column || !title) return
    const characters = ($t.splash.title.join(' ') + $t.splash.intro).length
    const { min, max } = textRange(
      characters,
      region.cssPxInWorld,
      region.rect.width / region.cssPxInWorld,
      false,
    )
    fitText(column, min * MIN_SHARE, max, { across: title })
  }
  $effect(() => {
    void layout.text.width
    void layout.text.height
    void $t
    void region.cssPxInWorld
    if (!column) return
    void tick().then(fit)
  })
  onMount(() => {
    document.fonts?.addEventListener('loadingdone', fit)
    return () => document.fonts?.removeEventListener('loadingdone', fit)
  })
  // The column has no size until the engine first places the screen, so the
  // text is fitted again once it has.
  $effect(() => {
    if (!column) return
    const observer = new ResizeObserver(() => fit())
    observer.observe(column)
    return () => observer.disconnect()
  })

  // The panel fills its box, wherever the window puts it.
  $effect(() => {
    const box = panelBox
    panel.transform.x = box.x
    panel.transform.y = box.y
    outline.clear()
    layout.outline.forEach((point, i) => {
      if (i === 0) outline.moveTo(point.x, point.y)
      else outline.lineTo(point.x, point.y)
    })
    outline.close()
    backing.geometry = {
      kind: 'rect',
      width: box.width,
      height: box.height,
      centered: false,
    }
    if (!animation) return
    animation.width = box.width
    animation.height = box.height
  })

  // Coming back from the story, the splash waits for the story to clear.
  let shownBefore = false
  $effect(() => {
    const waiting = new AbortController()
    if (!active) void reveal.hide()
    else if (!shownBefore) reveal.show()
    else {
      engine
        .wait(MOTION.handoff, waiting.signal)
        .then(() => reveal.show())
        .catch(ignoreAbort)
    }
    shownBefore = true
    return () => waiting.abort()
  })

  // The panel fades with the last part and only plays while it shows.
  $effect(() => {
    const v = reveal.items[3]!.v
    panel.transform.alpha = v
    panel.visible = v > 0
    if (!animation) return
    if (v > 0 && !$splashPlayback.paused) animation.play()
    else animation.pause()
  })

  // Pausing remembers the frame, so a reload or a restart holds the same one.
  // Playing on from it needs nothing stored.
  $effect(() => {
    const node = animation
    const paused = $splashPlayback.paused
    if (!node || !paused) return
    const frame = node.currentFrame
    untrack(() => {
      if ($splashPlayback.frame !== frame) {
        splashPlayback.set({ paused: true, frame })
      }
    })
  })

  onDestroy(() => {
    destroyed = true
    reveal.destroy()
    panel.destroy()
    outline.release()
  })

  // The splash comes from the left and leaves to the left, so starting the
  // story moves on to the right, and stepping back to the splash comes back.
  const part = (i: number): string =>
    `opacity: ${reveal.items[i]!.v}; transform: translateX(${slideOffset(-1, reveal.items[i]!.v, MOTION.slideDistance)}px)`
</script>

<section
  class="splash"
  class:splash--hidden={!reveal.visible}
  aria-hidden={!active}
  use:domAnchor={{
    engine,
    node: region.anchor,
    size: { width: region.rect.width, height: region.rect.height },
  }}
  style:--column-x="{layout.text.x}px"
  style:--column-y="{layout.text.y}px"
  style:--column-height="{layout.text.height}px"
  style:--column-width="{layout.text.width}px"
  style:--panel-right="{region.rect.width -
    layout.panel.x -
    layout.panel.width}px"
  style:--panel-top="{layout.panel.y}px"
  style:--start-height="{MIN_TAP_CSS_PX * region.cssPxInWorld}px"
>
  <div
    class="splash__column"
    class:splash__column--stacked={layout.stacked}
    bind:this={column}
  >
    <h1 class="splash__title" style={part(0)} bind:this={title}>
      {#each $t.splash.title as line, i (i)}
        <span class="splash__line">{line}</span>
      {/each}
    </h1>
    <p class="splash__intro" style={part(1)}>{$t.splash.intro}</p>
    <button
      class="splash__start"
      style={part(2)}
      disabled={!active}
      onclick={onStart}
    >
      {$t.splash.start}
    </button>
  </div>
  <img
    class="splash__logos"
    src={LOGOS_URL}
    alt="OSPR and Mozilla"
    style:opacity={reveal.items[3]!.v}
  />
</section>

<style lang="sass">
  @use './type'

  // The engine sizes and places the section on the canvas.
  .splash
    position: absolute
    inset-block-start: 0
    inset-inline-start: 0
    color: var(--color-text)
    user-select: none
    -webkit-user-select: none

  .splash--hidden
    visibility: hidden

  // Sizes are in ems of the fitted text size, which is 32 on a 1920 pixel
  // screen, where they come to the design's.
  .splash__column
    position: absolute
    inset-inline-start: var(--column-x)
    inset-block-start: var(--column-y)
    display: flex
    flex-direction: column
    // Text taller than its column starts at the top and scrolls.
    justify-content: safe center
    align-items: flex-start
    gap: 2.9em
    box-sizing: border-box
    width: var(--column-width)
    height: var(--column-height)
    font-size: var(--text-size, 32px)

  // The design sits the text a little below the middle.
  .splash__column:not(.splash__column--stacked)
    padding-block-start: 3em

  // On a portrait screen the text can be longer than the room it has. The
  // anchor container ignores pointers, so the column takes them to scroll.
  .splash__column--stacked
    overflow-y: auto
    overscroll-behavior: contain
    pointer-events: auto
    scrollbar-width: none

  .splash__title
    @include type.headline
    font-size: 4.6em
    line-height: 1.05
    margin: 0
    max-width: 100%
    white-space: nowrap

  .splash__line
    display: block

  .splash__intro
    @include type.body
    font-size: 1.25em
    margin: 0

  // Over the panel's top right corner, which is under the HTML.
  .splash__logos
    position: absolute
    inset-block-start: calc(var(--panel-top) + 64px)
    inset-inline-end: calc(var(--panel-right) + 64px)
    width: 280px
    height: auto
    pointer-events: none

  .splash__start
    @include type.button
    display: flex
    align-items: center
    // Never shorter than a finger.
    font-size: 2.18em
    height: max(1.89em, var(--start-height))
    padding: 0 1em
    border: 0
    color: var(--color-text-inverse)
    background: var(--color-surface-inverse)
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:active
      background: var(--color-text-secondary)
</style>
