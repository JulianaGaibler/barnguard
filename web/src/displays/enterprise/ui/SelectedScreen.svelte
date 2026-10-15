<script lang="ts">
  /**
   * The screen after a region is picked: a card at the bottom with the region's
   * name and a Start button, and above it the high scores that exist. An HTML
   * node on the UI stage, laid out in design pixels against the region's
   * visible rect so it stays at the bottom of any window shape.
   *
   * Picking another region while this is up swaps the text with a short fade
   * instead of replaying the entrance.
   */
  import { onDestroy, untrack } from 'svelte'
  import {
    domAnchor,
    easings,
    ignoreAbort,
    Node2D,
    type Engine,
  } from '@src/stargazer'
  import {
    t,
    regionName,
    type RegionNamespace,
  } from '@src/displays/enterprise/i18n'
  import { nativeName } from '@src/displays/enterprise/i18n/nativeName'
  import { EU_REGION_META } from '@src/displays/enterprise/game/maps/eu/regionMeta'
  import {
    emptyHighScores,
    fetchEnterpriseHighScores,
    mapHigh,
    regionHigh,
    type EnterpriseHighScores,
  } from '@src/displays/enterprise/game-log'
  import type { UiRegion } from './uiRegion.svelte'
  import { Reveal } from './reveal.svelte'
  import { flagFor } from './flags'
  import { fitText } from './fitText'
  import ScorePill from './ScorePill.svelte'

  interface Props {
    engine: Engine
    region: UiRegion
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** The picked region, or `null` once none is. The card keeps the last one. */
    regionId: string | null
    mapId: string
    namespace: RegionNamespace
    onStart: () => void
  }
  let { engine, region, active, regionId, mapId, namespace, onStart }: Props =
    $props()

  const NAME_WIDTH = 412

  const node = new Node2D('selected-screen')
  // The engine and region are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(node)
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 2)
  /** Text opacity, dipped while the card changes from one region to another. */
  const textFade = $state({ v: 1 })

  /**
   * The region the card describes, held through the exit after `regionId`
   * clears.
   */
  let shown = $state<string | null>(null)
  let highScores = $state<EnterpriseHighScores>(emptyHighScores())

  $effect(() => {
    const next = regionId
    if (next === null || next === untrack(() => shown)) return
    untrack(() => {
      if (shown === null || !active) {
        shown = next
        return
      }
      void swapTo(next)
    })
  })

  async function swapTo(next: string): Promise<void> {
    try {
      await engine.tween(textFade, { v: 0 }, { duration: 0.12, key: 'swap' })
      shown = next
      await engine.tween(
        textFade,
        { v: 1 },
        { duration: 0.2, easing: easings.outCubic, key: 'swap' },
      )
    } catch (err) {
      ignoreAbort(err)
    }
  }

  $effect(() => {
    if (active) reveal.show()
    else void reveal.hide()
  })

  // Refetched whenever the screen opens, so an attendant's deletes show up.
  $effect(() => {
    if (!active) return
    let alive = true
    fetchEnterpriseHighScores()
      .then((scores) => {
        if (alive) highScores = scores
      })
      .catch((err: unknown) => {
        console.warn('[selected] high-score fetch failed', err)
      })
    return () => {
      alive = false
    }
  })

  onDestroy(() => {
    reveal.destroy()
    node.destroy()
  })

  const name = $derived(shown === null ? '' : regionName($t, namespace, shown))
  const second = $derived(
    shown === null ? null : nativeName(mapId, shown, name),
  )
  const meta = $derived(
    shown !== null && mapId === 'eu' ? EU_REGION_META[shown] : undefined,
  )
  const flag = $derived(meta ? flagFor(meta.iso2) : null)
  const overall = $derived(mapHigh(highScores, mapId))
  const regional = $derived(
    shown === null ? 0 : regionHigh(highScores, mapId, shown),
  )

  const rise = (i: number): string =>
    `opacity: ${reveal.items[i].v}; transform: translateY(${(1 - reveal.items[i].v) * 64}px)`
</script>

<div
  class="selected"
  class:selected--hidden={!reveal.visible}
  use:domAnchor={{
    engine,
    node,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  <div class="selected__pills" style={rise(1)}>
    {#if overall > 0}
      <ScorePill label={$t.game.allScores} score={overall} />
    {/if}
    {#if regional > 0}
      {#if flag}
        <ScorePill {flag} score={regional} />
      {:else if shown}
        <ScorePill label={shown} score={regional} />
      {/if}
    {/if}
  </div>

  <div class="selected__card" style={rise(0)}>
    <div class="selected__names" style:opacity={textFade.v}>
      <h2
        class="selected__name"
        use:fitText={{ text: name, width: NAME_WIDTH, max: 64, min: 36 }}
      >
        {name}
      </h2>
      {#if second}
        <p class="selected__native">{second}</p>
      {/if}
    </div>
    <button class="selected__start" disabled={!active} onclick={onStart}>
      {$t.game.startButton}
    </button>
  </div>
</div>

<style lang="sass">
  .selected
    position: absolute
    inset: 0
    pointer-events: none

  .selected--hidden
    visibility: hidden

  // 902 wide and centred, 28 above the bottom edge. The pills ride 12 above the
  // card's top edge, which is 28 + 179 + 12 above the bottom.
  .selected__card
    position: absolute
    left: calc(50% - 451px)
    bottom: 28px
    width: 902px
    height: 179px
    box-sizing: border-box
    padding: 48px
    border-radius: 48px
    display: flex
    align-items: center
    justify-content: space-between
    background: linear-gradient(224.2deg, #fcf5f0 43.78%, #f9f9f9 91.31%), #ffffff
    pointer-events: auto

  .selected__pills
    position: absolute
    left: calc(50% - 451px)
    bottom: 219px
    display: flex
    gap: 12px
    align-items: center

  .selected__names
    width: 412px
    display: flex
    flex-direction: column
    gap: 17px
    align-items: flex-start
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    line-height: 1
    color: #15141a
    white-space: nowrap

  .selected__name
    margin: 0
    font-size: 64px
    font-weight: inherit
    letter-spacing: -1.28px
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

  .selected__native
    margin: 0
    font-size: 32px
    letter-spacing: -0.64px
    opacity: 0.6
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

  .selected__start
    appearance: none
    border: 0
    cursor: pointer
    min-width: 128px
    height: 80px
    padding: 20px 32px
    border-radius: 999px
    background: #15141a
    color: #ffffff
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: 40px
    line-height: 1.05
    letter-spacing: -0.8px
    white-space: nowrap
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

    &:disabled
      pointer-events: none
</style>
