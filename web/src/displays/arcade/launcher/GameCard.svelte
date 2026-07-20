<script lang="ts">
  import { t } from '@src/displays/arcade/i18n'
  import type { GameModule } from '@src/displays/arcade/games/GameModule'

  interface Props {
    game: GameModule
    onPlay: (game: GameModule) => void
  }
  const { game, onPlay }: Props = $props()

  const playersLabel = $derived(
    game.meta.players === '1' ? $t.arcade.player : $t.arcade.players,
  )
</script>

<div class="game-card">
  <div class="game-card__thumb" style="background:{game.meta.thumbColor}"></div>
  <div class="game-card__body">
    <h2 class="game-card__title">{game.meta.title}</h2>
    <p class="game-card__desc">{game.meta.description}</p>
    <div class="game-card__footer">
      <span class="game-card__players">
        <strong>{game.meta.players}</strong>
        {playersLabel}
      </span>
      <button class="game-card__play" onclick={() => onPlay(game)}>
        {$t.arcade.play}
      </button>
    </div>
  </div>
</div>

<style lang="sass">
  // Thumb + body are two separate rounded, shadowed cards with an 8px gap.
  // Outer corners keep the full radius; the facing (inner) corners are 8px.
  // Thumb + body are two separate rounded, shadowed cards with a small gap.
  // Outer corners keep the full radius; the facing (inner) corners are tighter.
  .game-card
    display: flex
    flex-direction: column
    gap: var(--space-8)
    width: 22rem

  .game-card__thumb
    aspect-ratio: 16 / 11
    width: 100%
    border-radius: var(--space-40) var(--space-40) var(--space-12) var(--space-12)
    box-shadow: var(--color-shadow-card)

  .game-card__body
    display: flex
    flex-direction: column
    gap: var(--space-12)
    padding-block: var(--space-24) var(--space-16)
    padding-inline: var(--space-24)
    background: var(--color-surface-card)
    border-radius: var(--space-12) var(--space-12) var(--space-40) var(--space-40)
    box-shadow: var(--color-shadow-card)

  .game-card__title
    margin: 0
    @include tint.type-class(card-title)
    color: var(--color-text)

  .game-card__desc
    margin: 0
    @include tint.type-class(body)
    color: var(--color-text-secondary)
    line-height: 1.35

  .game-card__footer
    display: flex
    align-items: center
    justify-content: space-between
    margin-block-start: var(--space-8)

  .game-card__players
    @include tint.type-class(body)
    color: var(--color-text-secondary)

    strong
      @include tint.type-class(pill)
      color: var(--color-text)

  .game-card__play
    border: none
    cursor: pointer
    border-radius: var(--radius-pill)
    padding-block: var(--space-12)
    padding-inline: var(--space-32)
    @include tint.type-class(pill)
    // Dark label reads on the light play gradient (independent of the primary
    // action token, which is a dark fill).
    color: var(--color-text)
    background: var(--color-gradient-play)

    &:hover
      filter: brightness(1.03)
    &:active
      filter: brightness(0.97)
</style>
