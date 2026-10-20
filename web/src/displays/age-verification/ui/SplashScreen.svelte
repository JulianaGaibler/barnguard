<!--
  The first screen: the title, what the visitor is in for, and a button to
  begin, beside the splash animation. Laid out in design pixels against the
  region's visible area, by `layoutFor`. The animation is a stargazer node on a
  layer of its own, dithered, under the HTML.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    domAnchor,
    LottieNode,
    ignoreAbort,
    loadLottie,
    type Engine,
    type Layer,
  } from '@src/stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { SPLASH_ANIMATION_URL } from '../assets'
  import { inWorld, layoutFor } from './layout'
  import { MOTION, slideOffset } from './motion'

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** The layer the animation goes on. Its region is the right column. */
    layer: Layer
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    onStart: () => void
  }
  const { engine, region, layer, active, onStart }: Props = $props()

  const layout = $derived(layoutFor(region.rect.width, region.rect.height))
  const media = $derived(inWorld(layout.right, region.rect))

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
        console.warn(
          '[age-verification] splash animation failed to load',
          error,
        )
      })
  }

  // The animation fills the right column, wherever the window puts it.
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
  style="--row-x: {layout.rowX}px; --content-y: {layout.content
    .y}px; --content-height: {layout.content.height}px; --column-width: {layout
    .left.width}px"
>
  <div class="splash__column">
    <h1 class="splash__title" style={part(0)}>{$t.splash.title}</h1>
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
    inset-inline-start: var(--row-x)
    inset-block-start: var(--content-y)
    display: flex
    flex-direction: column
    justify-content: center
    align-items: flex-start
    gap: 64px
    width: var(--column-width)
    height: var(--content-height)

  .splash__title
    @include type.headline
    margin: 0

  .splash__intro
    @include type.body
    margin: 0

  .splash__start
    @include type.button
    display: flex
    align-items: center
    height: 80px
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
