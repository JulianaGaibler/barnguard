<!--
  The final score, presented as one more slab: the same extruded, generously
  rounded shape the board is built from, with the largest tile reached sitting
  beside the number in that tile's own color.
-->
<script lang="ts">
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'
  import { tileColor } from '../game/tuning'
  import { TWENTY48_STRINGS as t } from '../strings'

  interface Props {
    score: number
    /** The biggest tile the run produced, shown next to the score. */
    bestTile: number
    color: string
  }
  const { score, bestTile, color }: Props = $props()
</script>

<div class="frame">
  <div class="frame__score">
    <span class="frame__label">{t.scoreLabel}</span>
    <span class="frame__value" style="color: {color}">{formatScore(score)}</span
    >
  </div>
  {#if bestTile > 0}
    <div class="frame__tile" style="background: {tileColor(bestTile)}">
      <span class="frame__tile-label">{t.bestTileLabel}</span>
      <span class="frame__tile-value">{bestTile}</span>
    </div>
  {/if}
</div>

<style lang="sass">
  .frame
    display: flex
    align-items: stretch
    gap: var(--space-24)

  .frame__score
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: var(--space-4)
    padding: var(--space-24) var(--space-32)

  .frame__label
    @include tint.type-class(ui-small-bold)
    text-transform: uppercase
    letter-spacing: 0.08em
    color: var(--color-text-secondary)

  .frame__value
    @include tint.type-class(display)
    font-weight: 800
    white-space: nowrap
    font-variant-numeric: tabular-nums

  // A real tile, at card scale: same radius, and a hard bottom edge in place of
  // the canvas extrusion rather than a blurred shadow.
  .frame__tile
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: var(--space-4)
    min-width: 8rem
    padding: var(--space-16) var(--space-24)
    border-radius: var(--radius-card)
    box-shadow: 0 0.4rem 0 rgba(0, 0, 0, 0.24)
    color: var(--color-text-inverse)

  .frame__tile-label
    @include tint.type-class(ui-small-bold)
    text-transform: uppercase
    letter-spacing: 0.08em
    opacity: 0.75

  .frame__tile-value
    @include tint.type-class(title-1)
    font-weight: 800
</style>
