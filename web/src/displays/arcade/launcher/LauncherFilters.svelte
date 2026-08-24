<script lang="ts">
  import usersIconRaw from '@src/assets/icons/users-16.svg?raw'
  import LeaderboardIcon from '@src/displays/arcade/leaderboard/LeaderboardIcon.svelte'
  import { t } from '@src/displays/arcade/i18n'

  interface Props {
    /** Every player count some game runs at, ascending. */
    counts: readonly number[]
    /** Selected counts. Empty means no player-count constraint. */
    selectedCounts: ReadonlySet<number>
    leaderboardOnly: boolean
    aiOnly: boolean
    onToggleCount: (n: number) => void
    onToggleLeaderboard: () => void
    onToggleAi: () => void
  }
  const {
    counts,
    selectedCounts,
    leaderboardOnly,
    aiOnly,
    onToggleCount,
    onToggleLeaderboard,
    onToggleAi,
  }: Props = $props()
</script>

<!--
  The two chips past the divider exclude each other, a rule `browseState` owns.
  These stay plain toggles that render the state they are handed, so pressing
  one shows up here as the other un-pressing.
-->
<div class="filters" role="group" aria-label={$t.arcade.filters.label}>
  <span class="filters__icon" aria-hidden="true">{@html usersIconRaw}</span>

  {#each counts as n (n)}
    <button
      type="button"
      class="filters__chip"
      class:filters__chip--on={selectedCounts.has(n)}
      aria-pressed={selectedCounts.has(n)}
      aria-label={$t.arcade.filters.playerCount(n)}
      onclick={() => onToggleCount(n)}>{n}</button
    >
  {/each}

  <span class="filters__divider" aria-hidden="true"></span>

  <button
    type="button"
    class="filters__chip"
    class:filters__chip--on={leaderboardOnly}
    aria-pressed={leaderboardOnly}
    aria-label={$t.arcade.filters.leaderboardAriaLabel}
    onclick={onToggleLeaderboard}
  >
    <LeaderboardIcon size={16} />
  </button>
  <button
    type="button"
    class="filters__chip"
    class:filters__chip--on={aiOnly}
    aria-pressed={aiOnly}
    aria-label={$t.arcade.filters.aiAriaLabel}
    onclick={onToggleAi}>{$t.arcade.filters.ai}</button
  >
</div>

<style lang="sass">
  // These controls float on the ocean band, not on a card, so they do not take
  // the launcher's day and night palettes. Everything here is white at varying
  // strength. The idle chip stays unfilled on purpose: the water reaches
  // #AD8DF0 at sunset, and tinting a light backdrop white pushes it further
  // toward the ink rather than away from it.
  $chip-size: 2.5rem
  $ink: rgba(255, 255, 255, 0.82)
  $ink-quiet: rgba(255, 255, 255, 0.7)
  $edge: rgba(255, 255, 255, 0.4)
  $edge-hover: rgba(255, 255, 255, 0.7)

  .filters
    display: flex
    align-items: center
    gap: var(--space-8)
    // The launcher is click-through so the canvas keeps input. Opt back in.
    pointer-events: auto

  // The artwork runs flush to its viewBox on every side, so letting this
  // shrink as a flex item crops the second figure.
  .filters__icon
    display: flex
    align-items: center
    flex: 0 0 auto
    color: $ink-quiet
    margin-inline-end: var(--space-4)

    :global(svg)
      display: block
      flex: 0 0 auto
      width: 16px
      height: 16px

  .filters__divider
    flex: 0 0 auto
    width: 1px
    align-self: stretch
    margin-inline: var(--space-4)
    background: rgba(255, 255, 255, 0.3)

  .filters__chip
    @include tint.type-class(ui)
    display: inline-flex
    align-items: center
    justify-content: center
    // Square box plus a full radius, so every chip is the same circle.
    box-sizing: border-box
    inline-size: $chip-size
    block-size: $chip-size
    flex: 0 0 auto
    padding: 0
    border-radius: 50%
    border: 1px solid $edge
    background: transparent
    color: $ink
    cursor: pointer
    transition: background-color 120ms linear, color 120ms linear, border-color 120ms linear

    &:hover
      background: rgba(255, 255, 255, 0.12)
      border-color: $edge-hover
      color: #fff

  // Selected reads as a brighter, heavier ring rather than a filled pill. A
  // solid white fill would leave the glyph nothing to sit against. The weight
  // comes from the border alone: pairing it with an inset ring leaves a seam
  // where the two curves meet.
  .filters__chip--on
    background: rgba(255, 255, 255, 0.16)
    border-width: 2px
    border-color: #fff
    color: #fff

    &:hover
      background: rgba(255, 255, 255, 0.24)
      border-color: #fff
      color: #fff
</style>
