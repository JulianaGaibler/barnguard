<script lang="ts">
  /**
   * Striped bars down the left and right screen edges, marking where a packet
   * is lost when the edges of the screen are the loss line. An HTML node on the
   * UI layer, pinned to the region's side edges so the bars sit at the exact
   * edge of the screen at any window shape.
   *
   * The hatch lightens whatever is under it, so it reads as a paler stripe on
   * the background and on the map alike.
   */
  import { onDestroy } from 'svelte'
  import { domAnchor, Node2D, type Engine } from 'stargazer'
  import hatchRaw from '@src/displays/enterprise/assets/repeat.svg?raw'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { Reveal } from '@src/core/ui/reveal.svelte'

  interface Props {
    engine: Engine
    region: UiRegion
    /** Whether the bars are showing. Flipping it slides them in or out. */
    active: boolean
  }
  let { engine, region, active }: Props = $props()

  /**
   * The hatch as a data URI, escaped so any character in the markup is safe in
   * a `url()`.
   */
  const hatch = `url("data:image/svg+xml,${encodeURIComponent(hatchRaw)}")`

  const node = new Node2D('fail-edges')
  // The engine and region are fixed for the screen's life.
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

  /** How far each bar sits outside its edge before it slides in. */
  const slide = $derived((1 - reveal.items[0].v) * 32)
</script>

<div
  class="edges"
  class:edges--hidden={!reveal.visible}
  use:domAnchor={{
    engine,
    node,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  <div
    class="edges__bar edges__bar--left"
    style:background-image={hatch}
    style:transform="translateX({-slide}px)"
  ></div>
  <div
    class="edges__bar edges__bar--right"
    style:background-image={hatch}
    style:transform="translateX({slide}px)"
  ></div>
</div>

<style lang="sass">
  .edges
    position: absolute
    inset: 0
    pointer-events: none

  .edges--hidden
    visibility: hidden

  .edges__bar
    position: absolute
    top: 0
    bottom: 0
    width: 32px
    // The hatch is drawn on a 128 tile and shown at a quarter of that, one tile
    // across the bar, which gives the fine stripe pitch of the design.
    background-size: 32px 32px
    background-repeat: repeat-y
    mix-blend-mode: lighten

  .edges__bar--left
    left: 0
    background-position: left top

  .edges__bar--right
    right: 0
    background-position: right top
</style>
