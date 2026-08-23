<!--
  End of match, over the board rather than in front of it.

  Every org keeps its nine cards, dimmed with the points each one earned drawn
  over it, so the breakdown here reads against the board it came from. This
  panel takes the centre column the shortlists were in, so the two tables are
  narrow. Each row puts the arithmetic under the name it belongs to rather than
  beside it, which is what lets both orgs sit side by side in that width.
-->
<script lang="ts">
  import { fade } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import type { Rect } from '@src/stargazer'
  import { FS_STRINGS as t } from '../strings'
  import type { GameMode, GameOverView } from '../game'

  interface Props {
    result: GameOverView
    mode: GameMode
    /** The centre column, in coordinates local to the overlay. */
    panel: Rect
    onPlayAgain: () => void
    onMenu: () => void
  }
  const { result, mode, panel, onPlayAgain, onMenu }: Props = $props()

  const nameFor = (side: 0 | 1): string =>
    side === 0 ? t.playerOne : mode.kind === 'ai' ? t.computer : t.playerTwo

  const headline = $derived.by(() => {
    if (result.winner === null) return t.tie
    const tiedOnPoints = result.sides[0].total === result.sides[1].total
    return tiedOnPoints
      ? `${nameFor(result.winner)} ${t.tieBrokenBy}`
      : `${nameFor(result.winner)} ${t.winner}`
  })
</script>

<div
  class="fs-over"
  transition:fade={{ duration: 180 }}
  style:left="{panel.x}px"
  style:top="{panel.y}px"
  style:width="{panel.width}px"
  style:height="{panel.height}px"
>
  <Surface tone="light">
    <div class="fs-over__body">
      <h2 class="fs-over__title">{headline}</h2>
      <div class="fs-over__sides">
        {#each result.sides as side, i (i)}
          <section class="fs-over__side">
            <h3 class="fs-over__who">{nameFor(i as 0 | 1)}</h3>
            <ul class="fs-over__lines">
              {#each side.lines as line, j (j)}
                <li class="fs-over__line">
                  <span class="fs-over__name">{line.name}</span>
                  <span class="fs-over__points">{line.points}</span>
                  {#if line.detail}
                    <span class="fs-over__math">{line.detail}</span>
                  {/if}
                </li>
              {/each}
              <li class="fs-over__line">
                <span class="fs-over__name">{t.approvals}</span>
                <span class="fs-over__points">{side.approvals}</span>
              </li>
            </ul>
            <p class="fs-over__line fs-over__line--total">
              <span class="fs-over__name">{t.finalScore}</span>
              <span class="fs-over__points">{side.total}</span>
            </p>
          </section>
        {/each}
      </div>
      <div class="fs-over__actions">
        <Button variant="primary" onclick={onPlayAgain}>{t.playAgain}</Button>
        <Button variant="secondary" onclick={onMenu}>{t.menu}</Button>
      </div>
    </div>
  </Surface>
</div>

<style lang="sass">
  .fs-over
    position: absolute
    display: flex
    pointer-events: auto

  // The panel is sized by the board, so the card inside it has to take the rect
  // rather than the rect taking the card's content height.
  .fs-over :global(.surface)
    flex: 1
    min-height: 0
    display: flex

  .fs-over__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-12)
    padding: var(--space-24) var(--space-16)
    height: 100%
    box-sizing: border-box
    text-align: center

  .fs-over__title
    @include tint.type-class(card-title)
    color: var(--color-title)
    margin: 0

  // Both orgs at once, so the two totals can be compared without scrolling
  // between them. Whatever does not fit scrolls inside the panel rather than
  // pushing the buttons off the bottom.
  .fs-over__sides
    display: flex
    gap: var(--space-16)
    width: 100%
    min-height: 0
    flex: 1
    overflow-y: auto

  // A column, so the total can be pinned to the bottom of it. The two columns
  // stretch to the same height, which is what puts the two totals on one line
  // however many seats each org filled and however far the names wrapped.
  .fs-over__side
    flex: 1
    min-width: 0
    display: flex
    flex-direction: column

  .fs-over__who
    @include tint.type-class(ui-small-bold)
    color: var(--color-text)
    margin: 0 0 var(--space-4)
    padding-bottom: var(--space-4)
    border-bottom: 1px solid var(--color-border)

  .fs-over__lines
    list-style: none
    margin: 0
    padding: 0

  // Name and score on one line with the arithmetic tucked under the name, so a
  // column this narrow still reads as three columns of a table.
  .fs-over__line
    display: grid
    grid-template-areas: 'name points' 'math points'
    grid-template-columns: 1fr auto
    align-items: baseline
    column-gap: var(--space-8)
    margin: 0
    padding: var(--space-4) 0
    text-align: left

  .fs-over__line--total
    border-top: 1px solid var(--color-border)
    margin: auto 0 0
    padding-top: var(--space-4)

    .fs-over__name
      @include tint.type-class(ui-small-bold)

    .fs-over__points
      @include tint.type-class(score)

  .fs-over__name
    grid-area: name
    @include tint.type-class(body-small)
    color: var(--color-text)

  // Below the bottom of the type scale on purpose. The arithmetic is there to
  // be checked rather than read, and at the same size as the name above it the
  // two lines of a row stop reading as one row.
  .fs-over__math
    grid-area: math
    @include tint.type-class(body-small)
    color: var(--color-text-secondary)
    font-size: 0.7rem
    line-height: 1.2

  .fs-over__points
    grid-area: points
    @include tint.type-class(ui-small-bold)
    color: var(--color-accent)
    text-align: right

  .fs-over__actions
    display: flex
    gap: var(--space-12)
</style>
