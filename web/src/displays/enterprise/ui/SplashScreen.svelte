<script lang="ts">
  /**
   * The first screen: a headline, what the game is, and a button to begin, left
   * of a map that plays itself, with the map's top three in the corner. An HTML
   * node on the UI stage, laid out in design pixels against the region's
   * visible rect.
   */
  import { onDestroy } from 'svelte'
  import { domAnchor, Node2D, type Engine } from '@src/stargazer'
  import type { UiRegion } from './uiRegion.svelte'
  import { Reveal } from './reveal.svelte'
  import SplashBoard from './SplashBoard.svelte'

  interface Props {
    engine: Engine
    region: UiRegion
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    headline: string
    description: string
    playLabel: string
    /** The map whose leaderboard the corner card shows. */
    mapId: string
    onPlay: () => void
  }
  let {
    engine,
    region,
    active,
    headline,
    description,
    playLabel,
    mapId,
    onPlay,
  }: Props = $props()

  // The engine and region are fixed for the screen's life.
  const node = new Node2D('splash-screen')
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(node)
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 3)

  $effect(() => {
    if (active) reveal.show()
    else void reveal.hide()
  })

  onDestroy(() => {
    reveal.destroy()
    node.destroy()
  })

  const part = (i: number): string =>
    `opacity: ${reveal.items[i].v}; transform: translateY(${(1 - reveal.items[i].v) * 48}px)`
</script>

<div
  class="splash"
  class:splash--hidden={!reveal.visible}
  use:domAnchor={{
    engine,
    node,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  <div class="splash__column">
    <h1 class="splash__headline" style={part(0)}>{headline}</h1>
    <div class="splash__body">
      <p class="splash__description" style={part(1)}>{description}</p>
      <button
        class="splash__play"
        style={part(2)}
        disabled={!active}
        onclick={onPlay}
      >
        {playLabel}
      </button>
    </div>
  </div>
  <SplashBoard {engine} {active} {mapId} />
</div>

<style lang="sass">
  @use './screenType'

  .splash
    position: absolute
    inset: 0
    pointer-events: none

  .splash--hidden
    visibility: hidden

  // 640 wide, 105 from the left, centred a little below the middle.
  .splash__column
    position: absolute
    left: 105px
    width: 640px
    top: calc(50% + 24.5px)
    transform: translateY(-50%)
    display: flex
    flex-direction: column
    gap: 85px
    align-items: flex-start

  .splash__headline
    @include screenType.headline
    width: 100%

  .splash__body
    display: flex
    flex-direction: column
    gap: 66px
    align-items: flex-start
    width: 100%

  .splash__description
    margin: 0
    font-family: var(--font-mozilla-text)
    font-weight: 600
    font-size: 40px
    line-height: 1.07
    letter-spacing: -0.8px
    color: #15141a
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

  .splash__play
    pointer-events: auto
    appearance: none
    border: 0
    cursor: pointer
    padding: 40px 64px
    border-radius: 999px
    background: #15141a
    color: #ffffff
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: 80px
    line-height: 1.05
    letter-spacing: -1.6px
    white-space: nowrap
    // The padding is drawn to the cap-height box, so the label is trimmed the
    // same way the headline is.
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

    &:disabled
      pointer-events: none
</style>
