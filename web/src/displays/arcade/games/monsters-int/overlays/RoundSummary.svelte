<!--
  What a round was worth, and at the end of the game who won.

  The breakdown is spelled out rather than just totalled, because the scoring
  order is invisible otherwise: the multiplier applies to the number cards
  before any plus is added, so `x2` with a `+10` is not what most people expect.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Surface from '@src/core/ui/Surface.svelte'
  import Button from '@src/core/ui/Button.svelte'
  import SeatBadge from './SeatBadge.svelte'
  import { t as arcadeT } from '@src/displays/arcade/i18n'
  import { MONSTERS_INT_STRINGS as t } from '../strings'
  import { seatName, type GameOver, type RoundSummary } from '../game'

  interface Props {
    summary?: RoundSummary
    result?: GameOver
    onNext?: () => void
    onMenu?: () => void
  }
  const { summary, result, onNext, onMenu }: Props = $props()

  /** `11 + 5 = 16 x2 = 32 +4 = 36`, only showing the parts that applied. */
  function breakdown(score: RoundSummary['scores'][number]): string {
    if (score.total === 0 && score.numberSum > 0) return t.bust
    const parts = [`${score.numberSum}`]
    if (score.doubled) parts.push(`x2 = ${score.numberSum * 2}`)
    if (score.plusTotal > 0) parts.push(`+${score.plusTotal}`)
    if (score.sevenBonus > 0) parts.push(`+${score.sevenBonus} ${t.seven}`)
    return parts.join(' ')
  }
</script>

<div class="mi-sum" transition:fade={{ duration: 180 }}>
  <div class="mi-sum__card" transition:scale={{ start: 0.94, duration: 200 }}>
    <Surface tone="light">
      <div class="mi-sum__body">
        {#if result}
          <h2 class="mi-sum__title">
            {result.winners.length > 1
              ? t.sharedWin(result.winners.map(seatName))
              : t.winner(seatName(result.winners[0]!))}
          </h2>
          <ol class="mi-sum__rows">
            {#each result.standings as row (row.seat)}
              <li class="mi-sum__row">
                <span class="mi-sum__who">
                  <SeatBadge seat={row.seat} />
                  {seatName(row.seat)}
                </span>
                <span class="mi-sum__value">{row.total}</span>
              </li>
            {/each}
          </ol>
          <p class="mi-sum__note">
            {result.early ? t.calledEarly : t.afterRounds(result.rounds)}
          </p>
          <Button variant="primary" onclick={() => onMenu?.()}
            >{$arcadeT.arcade.leaderboard.menu}</Button
          >
        {:else if summary}
          <h2 class="mi-sum__title">{t.roundOver}</h2>
          <ol class="mi-sum__rows">
            {#each summary.scores as score (score.seat)}
              <li class="mi-sum__row">
                <span class="mi-sum__who">
                  <SeatBadge seat={score.seat} />
                  {seatName(score.seat)}
                </span>
                <span class="mi-sum__calc">{breakdown(score)}</span>
                <span class="mi-sum__value">
                  {summary.totals[score.seat]}
                </span>
              </li>
            {/each}
          </ol>
          <Button variant="primary" onclick={() => onNext?.()}>
            {t.nextRound}
          </Button>
        {/if}
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .mi-sum
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .mi-sum__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    padding-block: var(--space-40)
    padding-inline: var(--space-48)
    text-align: center

  .mi-sum__title
    margin: 0
    @include tint.type-class(headline)

  .mi-sum__rows
    display: flex
    flex-direction: column
    gap: var(--space-8)
    margin: 0
    padding: 0
    list-style: none
    min-width: 22rem

  .mi-sum__row
    display: grid
    grid-template-columns: 1fr auto auto
    align-items: center
    gap: var(--space-16)

  .mi-sum__who
    display: inline-flex
    align-items: center
    gap: var(--space-8)
    @include tint.type-class(ui-bold)

  .mi-sum__calc
    @include tint.type-class(ui-small)
    color: var(--color-text-secondary)

  .mi-sum__value
    @include tint.type-class(score)
    min-width: 3ch
    text-align: right

  .mi-sum__note
    margin: 0
    @include tint.type-class(ui-small)
    color: var(--color-text-secondary)
</style>
