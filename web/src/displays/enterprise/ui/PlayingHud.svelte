<script lang="ts">
  /**
   * The round's header: the time survived, the score, and the region's name, as
   * three pills along the top edge. An HTML node on the UI layer, pinned to the
   * region's top corners so it stays there at any window shape.
   *
   * Tapping any pill pauses the round. The space between them takes no pointer
   * events, so taps there reach the map.
   */
  import { onDestroy, onMount, untrack } from 'svelte'
  import {
    domAnchor,
    easings,
    ignoreAbort,
    Node2D,
    type Engine,
  } from 'stargazer'
  import { formatElapsed } from '@src/displays/enterprise/format/formatElapsed'
  import {
    monoChars,
    splitScore,
  } from '@src/displays/enterprise/format/splitScore'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import MonoDigits from './MonoDigits.svelte'

  interface Props {
    engine: Engine
    region: UiRegion
    /** Whether the header is showing. Flipping it plays the entrance or exit. */
    active: boolean
    score: number
    /** Seconds the round has run, read each frame. */
    elapsed: () => number
    regionName: string
    /** Called when a pill is tapped, to pause the round. */
    onPause: () => void
  }
  let { engine, region, active, score, elapsed, regionName, onPause }: Props =
    $props()

  const node = new Node2D('playing-hud')
  // The engine and region are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(node)
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 3)
  /** Zero at rest, one at the top of the score pill's pop. */
  const pop = $state({ v: 0 })

  /** Whole seconds shown, so the pill only re-renders when the clock ticks. */
  let seconds = $state(0)
  let lastScore = 0

  onMount(() => {
    return engine.events.on('frame', () => {
      const next = Math.floor(elapsed())
      if (next !== seconds) seconds = next
    })
  })

  $effect(() => {
    if (active) reveal.show()
    else void reveal.hide()
  })

  // A scored packet pops the score pill. Starting a tween reads the value it
  // animates, which an effect would track, so it runs untracked.
  $effect(() => {
    const next = score
    untrack(() => {
      if (next > lastScore && active) void popScore()
      lastScore = next
    })
  })

  async function popScore(): Promise<void> {
    try {
      await engine.tween(
        pop,
        { v: 1 },
        { duration: 0.08, easing: easings.outCubic, key: 'pop' },
      )
      await engine.tween(
        pop,
        { v: 0 },
        { duration: 0.25, easing: easings.outBack, key: 'pop' },
      )
    } catch (err) {
      ignoreAbort(err)
    }
  }

  onDestroy(() => {
    reveal.destroy()
    node.destroy()
  })

  const drop = (i: number, extra = ''): string =>
    `opacity: ${reveal.items[i].v}; transform: translateY(${-(1 - reveal.items[i].v) * 96}px) ${extra}`
</script>

<div
  class="hud"
  class:hud--hidden={!reveal.visible}
  use:domAnchor={{
    engine,
    node,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  <div class="hud__left">
    <button
      class="hud__pill hud__pill--time"
      style={drop(0)}
      disabled={!active}
      onclick={onPause}
    >
      <MonoDigits chars={monoChars(formatElapsed(seconds))} family="text" />
    </button>
    <button
      class="hud__pill hud__pill--score"
      style={drop(1, `scale(${1 + pop.v * 0.14})`)}
      disabled={!active}
      onclick={onPause}
    >
      <MonoDigits chars={splitScore(score)} family="text" />
    </button>
  </div>
  <button
    class="hud__pill hud__pill--name"
    style={drop(2)}
    disabled={!active}
    onclick={onPause}
  >
    {regionName}
  </button>
</div>

<style lang="sass">
  .hud
    position: absolute
    inset: 0
    pointer-events: none

  .hud--hidden
    visibility: hidden

  .hud__left
    position: absolute
    top: 28px
    left: 56px
    display: flex
    gap: 16px

  .hud__pill
    appearance: none
    border: 0
    cursor: pointer
    pointer-events: auto
    display: inline-flex
    align-items: center
    justify-content: center
    box-sizing: border-box
    height: 67px
    padding: 12px 24px
    border-radius: 999px
    font-family: var(--font-mozilla-text)
    font-weight: 700
    font-size: 36px
    white-space: nowrap
    background: #ffffff
    color: #000000

  .hud__pill--time
    background: #000000
    color: #ffffff

  .hud__pill--score
    transform-origin: left center

  .hud__pill--name
    position: absolute
    top: 28px
    right: 64px
</style>
