<!--
  End of match. Both orgs are shown with a per-card breakdown, because a final
  score in this game is nine separate rules and is unreadable without it.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { OO_STRINGS as t } from '../strings'
  import type { GameMode, GameOverView } from '../game'

  interface Props {
    result: GameOverView
    mode: GameMode
    onPlayAgain: () => void
    onMenu: () => void
  }
  const { result, mode, onPlayAgain, onMenu }: Props = $props()

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

<div class="oo-over" transition:fade={{ duration: 180 }}>
  <div class="oo-over__card" transition:scale={{ start: 0.94, duration: 220 }}>
    <Surface tone="light">
      <div class="oo-over__body">
        <h2 class="oo-over__title">{headline}</h2>
        <div class="oo-over__sides">
          {#each result.sides as side, i (i)}
            <section class="oo-over__side">
              <header class="oo-over__head">
                <span class="oo-over__who">{nameFor(i as 0 | 1)}</span>
                <span class="oo-over__total">{side.total}</span>
              </header>
              <ul class="oo-over__lines">
                {#each side.lines as line, j (j)}
                  <li class="oo-over__line">
                    <span class="oo-over__name">{line.name}</span>
                    <span class="oo-over__detail">{line.detail}</span>
                    <span class="oo-over__points">{line.points}</span>
                  </li>
                {/each}
                <li class="oo-over__line oo-over__line--sum">
                  <span class="oo-over__name">{t.approvals}</span>
                  <span class="oo-over__detail"></span>
                  <span class="oo-over__points">{side.approvals}</span>
                </li>
              </ul>
            </section>
          {/each}
        </div>
        <div class="oo-over__actions">
          <Button variant="primary" onclick={onPlayAgain}>{t.playAgain}</Button>
          <Button variant="secondary" onclick={onMenu}>{t.menu}</Button>
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .oo-over
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .oo-over__card
    max-width: 92vw
    max-height: 88vh
    overflow: auto

  .oo-over__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48)
    padding-inline: var(--space-32)

  .oo-over__title
    @include tint.type-class(headline)
    color: var(--color-title)
    margin: 0

  .oo-over__sides
    display: flex
    gap: var(--space-24)

  .oo-over__side
    min-width: 20rem

  .oo-over__head
    display: flex
    justify-content: space-between
    align-items: baseline
    border-bottom: 1px solid var(--color-border)
    padding-bottom: var(--space-4)

  .oo-over__who
    @include tint.type-class(card-title)
    color: var(--color-text)

  .oo-over__total
    @include tint.type-class(score)
    color: var(--color-accent)

  .oo-over__lines
    list-style: none
    margin: 0
    padding: 0

  .oo-over__line
    display: grid
    grid-template-columns: 8rem 1fr auto
    gap: var(--space-8)
    padding: var(--space-2) 0

  .oo-over__line--sum
    border-top: 1px solid var(--color-border)
    margin-top: var(--space-4)
    padding-top: var(--space-4)

  .oo-over__name
    @include tint.type-class(body-small)
    color: var(--color-text)

  .oo-over__detail
    @include tint.type-class(body-small)
    color: var(--color-text-secondary)

  .oo-over__points
    @include tint.type-class(ui-small-bold)
    color: var(--color-text)

  .oo-over__actions
    display: flex
    gap: var(--space-12)
</style>
