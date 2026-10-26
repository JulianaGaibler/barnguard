<!--
  The first screen: the title, what the visitor is in for, and a button to
  begin, beside the splash animation, or under it on a portrait screen. Laid out
  in design pixels against the region's visible area, by `layoutIn`. The
  animation is a stargazer node on a layer of its own, dithered, under the HTML.
  The layout reaches the markup through `style:` directives. A `style` attribute
  would erase the inline transform and size that `domAnchor` writes whenever it
  changed.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    domAnchor,
    LottieNode,
    ignoreAbort,
    loadLottie,
    type Engine,
    type Layer,
  } from 'stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { SPLASH_ANIMATION_URL } from '../assets'
  import { fitText, textRange } from './fitText'
  import { inWorld, layoutIn, tapHeight } from './layout'
  import { MOTION, slideOffset } from './motion'

  /** The start button's height in design pixels, before the tap floor. */
  const START_HEIGHT = 80

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** The layer the animation goes on. Its region is the media box. */
    layer: Layer
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    onStart: () => void
  }
  const { engine, region, layer, active, onStart }: Props = $props()

  const layout = $derived(
    layoutIn(region, SPLASH_ANIMATION_URL ? 'picture' : 'text'),
  )
  const media = $derived(inWorld(layout.media, region.rect))

  // The engine and layer are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 4)
  let animation = $state.raw<LottieNode | null>(null)
  let destroyed = false

  if (SPLASH_ANIMATION_URL) {
    loadLottie(SPLASH_ANIMATION_URL)
      .then((parsed) => {
        if (destroyed) return
        const node = new LottieNode({
          id: 'splash-animation',
          animation: parsed,
          width: media.width,
          height: media.height,
        })
        node.transform.alpha = 0
        layer.add(node)
        animation = node
      })
      .catch((error: unknown) => {
        console.warn('[policy-story] splash animation failed to load', error)
      })
  }

  // The text takes the largest size at which the column holds it. The title is
  // set in proportion, so the two shrink together.
  let column = $state<HTMLElement | null>(null)
  function fit(): void {
    if (!column) return
    const characters = $t.splash.title.length + $t.splash.intro.join('').length
    const { min, max } = textRange(
      characters,
      region.cssPxInWorld,
      region.rect.width / region.cssPxInWorld,
      false,
    )
    fitText(column, min, max)
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

  // The animation fills the media box, wherever the window puts it.
  $effect(() => {
    layer.region = { ...media }
    if (!animation) return
    animation.transform.x = media.x
    animation.transform.y = media.y
    animation.width = media.width
    animation.height = media.height
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

  // The animation fades with the last part and only plays while it shows.
  $effect(() => {
    if (!animation) return
    const v = reveal.items[3]!.v
    animation.transform.alpha = v
    // A layer nobody can see should not take a surface.
    layer.visible = v > 0
    if (v > 0) animation.play()
    else animation.pause()
  })

  onDestroy(() => {
    destroyed = true
    reveal.destroy()
    animation?.destroy()
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
  style:--start-height="{tapHeight(START_HEIGHT, region.cssPxInWorld)}px"
>
  <div
    class="splash__column"
    class:splash__column--stacked={layout.stacked}
    bind:this={column}
  >
    <h1 class="splash__title" style={part(0)}>{$t.splash.title}</h1>
    <div class="splash__intro" style={part(1)}>
      {#each $t.splash.intro as paragraph, i (i)}
        <p>{paragraph}</p>
      {/each}
    </div>
    <button
      class="splash__start"
      style={part(2)}
      disabled={!active}
      onclick={onStart}
    >
      {$t.splash.start}
    </button>
  </div>
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

  .splash__column
    position: absolute
    inset-inline-start: var(--column-x)
    inset-block-start: var(--column-y)
    display: flex
    flex-direction: column
    justify-content: safe center
    align-items: flex-start
    gap: 0.9em
    box-sizing: border-box
    width: var(--column-width)
    height: var(--column-height)
    font-size: var(--text-size, 44px)

  // On a portrait screen the text can be longer than the room it has. The
  // anchor container ignores pointers, so the column takes them to scroll.
  .splash__column--stacked
    overflow-y: auto
    overscroll-behavior: contain
    pointer-events: auto
    scrollbar-width: none

  .splash__title
    @include type.headline
    font-size: 3.4em
    margin: 0 0 0.25em

  .splash__intro
    display: flex
    flex-direction: column
    gap: 0.9em

    p
      @include type.body
      font-size: 1em
      margin: 0

  .splash__start
    @include type.button
    display: flex
    align-items: center
    height: var(--start-height, 80px)
    padding: 20px 48px
    border: 0
    color: var(--color-action-primary-text)
    background: var(--color-action-primary)
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:active
      background: var(--color-action-primary-active)
</style>
