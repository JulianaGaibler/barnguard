<!--
  How Buffer Overflow presents a finished run's score, for the shared game-over
  panels to render at the top of their card.

  A framed pane with an inverse title bar, matching the ones the canvas draws,
  so the result reads as the same application rather than as a card floating
  over it. The number is the leaderboard's, and the line under it is what the
  number does not say.
-->
<script lang="ts">
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'

  interface Props {
    score: number
    /** Headline, naming how the run ended. Sits in the bar, knocked out. */
    title: string
    /** One line of detail under the number. */
    detail?: string
    color: string
  }
  const { score, title, detail, color }: Props = $props()
</script>

<div class="frame">
  <span class="frame__bar" style:background={color}>{title}</span>
  <span class="frame__score">{formatScore(score)}</span>
  {#if detail}
    <span class="frame__detail">{detail}</span>
  {/if}
</div>

<style lang="sass">
  .frame
    display: flex
    flex-direction: column
    align-items: stretch
    text-align: center
    background: var(--color-surface)
    // Square, and ruled rather than shadowed. Every frame in this game is one
    // hairline and no radius, and a rounded card here would be the only
    // exception on screen.
    border-radius: 0
    box-shadow: inset 0 0 0 1px var(--color-border)

  .frame__bar
    @include tint.type-class(ui-small-bold)
    text-transform: lowercase
    padding-block: var(--space-4)
    padding-inline: var(--space-16)
    color: var(--color-text-inverse)

  .frame__score
    @include tint.type-class(score)
    font-variant-numeric: tabular-nums slashed-zero
    color: var(--color-text)
    padding-inline: var(--space-32)
    padding-block-start: var(--space-8)

  .frame__detail
    @include tint.type-class(ui)
    color: var(--color-text-secondary)
    padding-inline: var(--space-32)
    padding-block-end: var(--space-16)
</style>
