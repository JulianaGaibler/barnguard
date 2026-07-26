<script lang="ts">
  import { t } from '@src/displays/arcade/i18n'
  import type { GameModule } from '@src/displays/arcade/games/GameModule'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import { formatScore } from '@src/displays/arcade/leaderboard/formatScore'
  import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'

  interface Props {
    game: GameModule
    onPlay: (game: GameModule) => void
    /**
     * `undefined`: not a leaderboard game. `null`: leaderboard game, no entry
     * (yet, or none). Populated: show it.
     */
    topEntry?: LeaderboardEntry | null
  }
  const { game, onPlay, topEntry }: Props = $props()

  const playersLabel = $derived(
    game.meta.players === '1' ? $t.arcade.player : $t.arcade.players,
  )
</script>

<div class="game-card">
  <div class="game-card__thumb" style="background:{game.meta.thumbColor}">
    {#if game.meta.thumbImage}
      <img class="game-card__thumb-img" src={game.meta.thumbImage} alt="" />
    {/if}
  </div>
  <div class="game-card__body">
    <div class="game-card__heading">
      <h2 class="game-card__title">{game.meta.title}</h2>
      {#if game.meta.supportsLeaderboard}
        <div
          class="game-card__badge-frame"
          class:game-card__badge-frame--hidden={!topEntry}
        >
          <div class="game-card__badge">
            <LeaderboardIcon size={14} filled gold />
            <span class="game-card__badge-name"
              >{topEntry ? topEntry.name.toUpperCase() : ''}</span
            >
            <span class="game-card__badge-score"
              >{topEntry ? formatScore(topEntry.score) : ''}</span
            >
          </div>
        </div>
      {/if}
    </div>
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
    // Matches the `--launcher-card-w` set on the carousel root in
    // `Launcher.svelte`, so the card's rendered width and the track's snap/
    // centering math never drift apart.
    width: var(--launcher-card-w, 22rem)
    // Fills the launcher track's grid row (every card is stretched to the
    // same height there), so all cards in the carousel read as equal height.
    height: 100%

  .game-card__thumb
    aspect-ratio: 16 / 11
    width: 100%
    overflow: hidden
    border-radius: var(--space-40) var(--space-40) var(--space-12) var(--space-12)
    box-shadow: var(--color-shadow-card)

  .game-card__thumb-img
    display: block
    width: 100%
    height: 100%
    object-fit: cover

  .game-card__body
    display: flex
    flex-direction: column
    gap: var(--space-12)
    padding-block: var(--space-24) var(--space-16)
    padding-inline: var(--space-24)
    background: var(--color-surface-card)
    border-radius: var(--space-12) var(--space-12) var(--space-40) var(--space-40)
    box-shadow: var(--color-shadow-card)
    // Fills whatever's left of the card below the (fixed-aspect) thumb, so the
    // description below can stretch to push the footer to the bottom.
    flex: 1
    min-height: 0

  .game-card__heading
    display: flex
    align-items: center
    justify-content: space-between
    gap: var(--space-12)

  .game-card__title
    margin: 0
    min-width: 0
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    @include tint.type-class(card-title)
    color: var(--color-text)

  .game-card__badge-frame
    display: inline-flex
    flex-shrink: 0
    padding: 2px
    border-radius: var(--radius-pill)
    background: var(--color-gradient-leaderboard-border)

  .game-card__badge-frame--hidden
    visibility: hidden

  .game-card__badge
    display: inline-flex
    align-items: center
    gap: var(--space-8)
    padding-inline: var(--space-12)
    padding-block: var(--space-4)
    // Concentric with the frame's radius: inner corner = outer corner - padding.
    border-radius: calc(var(--radius-pill) - 2px)
    background: var(--color-surface-card)

  .game-card__badge-name
    @include tint.type-class(ui-bold)
    color: var(--color-text)

  .game-card__badge-score
    @include tint.type-class(ui-small-bold)
    color: var(--color-text-secondary)

  .game-card__desc
    margin: 0
    @include tint.type-class(body)
    color: var(--color-text-secondary)
    line-height: 1.35
    // Stretches to fill the leftover space in the body, so the footer below
    // (player count + play button) always sits flush with the card's bottom
    // regardless of how long the description is.
    flex: 1

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
