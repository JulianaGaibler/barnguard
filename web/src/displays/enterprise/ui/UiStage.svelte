<script lang="ts">
  /**
   * A transparent stage over the map canvas that carries the screen UI. Its
   * camera never moves, so HTML nodes anchored in it stay put while the map
   * stage zooms underneath. The canvas takes no pointer events, only the
   * elements placed in the layer do.
   *
   * The stage draws nothing of its own yet, it exists so UI nodes have a scene
   * and a steady camera to anchor to.
   */
  import type { Snippet } from 'svelte'
  import { mountStage, type Engine, type Stage } from '@src/stargazer'
  import { UiRegion } from './uiRegion.svelte'

  interface Props {
    engine: Engine
    children: Snippet<[UiRegion]>
  }
  let { engine, children }: Props = $props()

  let region = $state<UiRegion | null>(null)
  let stage: Stage | null = null

  function onReady(s: Stage): void {
    stage = s
    region = new UiRegion(s)
  }

  function onResize(): void {
    if (stage && region) region.resize(stage)
  }

  function onDestroy(): void {
    region?.destroy()
    region = null
    stage = null
  }
</script>

<canvas
  class="ui__canvas"
  use:mountStage={{
    engine,
    options: { transparent: true, name: 'UI', onResize },
    onReady,
    onDestroy,
  }}
></canvas>

<div class="ui__layer">
  {#if region}
    {@render children(region)}
  {/if}
</div>

<style lang="sass">
  .ui__canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    pointer-events: none

  // Exactly over the canvas, as `domAnchor` requires. Taps fall through to the
  // map except where an element inside opts back in.
  .ui__layer
    position: absolute
    inset: 0
    overflow: hidden
    pointer-events: none
</style>
