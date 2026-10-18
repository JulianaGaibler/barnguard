<!--
  The first screen: the title, what the visitor is in for, and a button to
  begin, beside the splash animation. Laid out in the 1920 by 1080 design
  frame. The animation is a stargazer node on the UI layer, under the HTML.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    LottieNode,
    loadLottie,
    type Engine,
    type Layer,
  } from '@src/stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import { t } from '../i18n'
  import { SPLASH_ANIMATION_URL } from '../assets'

  /** The box the animation is fitted into, in design pixels. */
  const ANIMATION_BOX = { x: 1024, y: 159, width: 768, height: 760 }

  interface Props {
    engine: Engine
    /** The UI layer, for the animation. */
    layer: Layer
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    onStart: () => void
  }
  const { engine, layer, active, onStart }: Props = $props()

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
          width: ANIMATION_BOX.width,
          height: ANIMATION_BOX.height,
        })
        node.transform.x = ANIMATION_BOX.x
        node.transform.y = ANIMATION_BOX.y
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

  $effect(() => {
    if (active) reveal.show()
    else void reveal.hide()
  })

  // The animation fades with the last part and only plays while it shows.
  $effect(() => {
    if (!animation) return
    const v = reveal.items[3]!.v
    animation.transform.alpha = v
    if (v > 0) animation.play()
    else animation.pause()
  })

  onDestroy(() => {
    destroyed = true
    reveal.destroy()
    animation?.destroy()
  })

  const part = (i: number): string =>
    `opacity: ${reveal.items[i]!.v}; transform: translateY(${(1 - reveal.items[i]!.v) * 48}px)`
</script>

<section
  class="splash"
  class:splash--hidden={!reveal.visible}
  aria-hidden={!active}
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

  .splash
    position: absolute
    inset: 0
    color: var(--color-text)

  .splash--hidden
    visibility: hidden

  .splash__column
    position: absolute
    inset-inline-start: 128px
    inset-block-start: 159px
    display: flex
    flex-direction: column
    justify-content: center
    align-items: flex-start
    gap: 64px
    width: 768px
    height: 760px

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
