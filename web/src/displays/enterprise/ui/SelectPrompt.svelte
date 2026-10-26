<script lang="ts">
  /**
   * The picker's headline, left of the map the player taps. Tapping it goes
   * back to the splash. An HTML node on the UI layer, laid out in design pixels
   * against the region's visible rect.
   */
  import { onDestroy } from 'svelte'
  import { domAnchor, Node2D, type Engine } from 'stargazer'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { Reveal } from '@src/core/ui/reveal.svelte'

  interface Props {
    engine: Engine
    region: UiRegion
    /** Whether the prompt is showing. Flipping it plays the entrance or exit. */
    active: boolean
    prompt: string
    onBack: () => void
  }
  let { engine, region, active, prompt, onBack }: Props = $props()

  // The engine and region are fixed for the screen's life.
  const node = new Node2D('select-prompt')
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(node)
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 1)

  $effect(() => {
    if (active) reveal.show()
    else void reveal.hide()
  })

  onDestroy(() => {
    reveal.destroy()
    node.destroy()
  })
</script>

<div
  class="prompt"
  class:prompt--hidden={!reveal.visible}
  use:domAnchor={{
    engine,
    node,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  <h1
    class="prompt__headline"
    style="opacity: {reveal.items[0].v}; transform: translateY({(1 -
      reveal.items[0].v) *
      48}px)"
  >
    <button class="prompt__back" disabled={!active} onclick={onBack}>
      {prompt}
    </button>
  </h1>
</div>

<style lang="sass">
  @use './screenType'

  .prompt
    position: absolute
    inset: 0
    pointer-events: none

  .prompt--hidden
    visibility: hidden

  .prompt__headline
    @include screenType.headline
    position: absolute
    left: 105px
    width: 640px
    top: calc(50% - 155px)

  // A block with the headline's own type, so the cap height trim applies to
  // the button's lines. Trim on the heading does not reach into an inline
  // button.
  .prompt__back
    @include screenType.headline
    display: block
    pointer-events: auto
    appearance: none
    border: 0
    padding: 0
    background: none
    text-align: inherit
    cursor: pointer
</style>
