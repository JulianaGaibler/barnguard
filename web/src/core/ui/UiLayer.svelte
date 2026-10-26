<script lang="ts">
  /**
   * The screen UI, hung on a layer of the display's own scene that never moves
   * with the scene camera, so HTML nodes anchored in it stay put while the
   * world moves underneath. The layer is fitted to the design region and draws
   * after the world, so engine-drawn UI sits over it and under the HTML.
   *
   * The element is exactly over the canvas, as `domAnchor` requires. Taps fall
   * through to the canvas except where an element inside opts back in.
   */
  import { onDestroy, type Snippet } from 'svelte'
  import type { Engine, Layer } from 'stargazer'
  import { UiRegion } from './uiRegion.svelte'

  interface Props {
    engine: Engine
    /** The layer the UI hangs on, already in the engine's scene. */
    layer: Layer
    children: Snippet<[UiRegion]>
  }
  let { engine, layer, children }: Props = $props()

  // The engine and layer are fixed for this component's life, since a new
  // engine remounts it.
  /* svelte-ignore state_referenced_locally */
  const region = new UiRegion(engine, layer)
  onDestroy(() => region.destroy())
</script>

<div class="ui__layer">
  {@render children(region)}
</div>

<style lang="sass">
  // Exactly over the canvas, as `domAnchor` requires. Taps fall through to the
  // canvas except where an element inside opts back in.
  .ui__layer
    position: absolute
    inset: 0
    overflow: hidden
    pointer-events: none
</style>
