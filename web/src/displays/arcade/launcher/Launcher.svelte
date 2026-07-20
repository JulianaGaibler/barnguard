<script lang="ts">
  import arcadeLogo from '@src/displays/arcade/assets/arcade-logo.svg?url'
  import { GAMES } from '@src/displays/arcade/games/registry'
  import type { GameModule } from '@src/displays/arcade/games/GameModule'
  import GameCard from './GameCard.svelte'

  interface Props {
    onPlay: (game: GameModule) => void
  }
  const { onPlay }: Props = $props()
</script>

<div class="launcher">
  <header class="launcher__header">
    <img class="launcher__logo" src={arcadeLogo} alt="Arcade" />
  </header>

  <div class="launcher__row">
    {#each GAMES as game (game.meta.id)}
      <GameCard {game} {onPlay} />
    {/each}
  </div>
</div>

<style lang="sass">
  .launcher
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    justify-content: center
    // Cards read against the engine background; only they + the header capture
    // pointer events.
    pointer-events: none

  .launcher__header
    position: absolute
    inset-block-start: var(--space-48)
    inset-inline-start: var(--space-48)
    display: flex
    flex-direction: column
    gap: var(--space-4)

  .launcher__logo
    height: 4.5rem
    width: auto

  .launcher__row
    display: flex
    gap: var(--space-32)
    justify-content: center
    align-items: stretch
    padding-block: 0
    padding-inline: var(--space-48)
    flex-wrap: wrap
    // Re-enable interaction for the cards themselves.
    pointer-events: auto
</style>
