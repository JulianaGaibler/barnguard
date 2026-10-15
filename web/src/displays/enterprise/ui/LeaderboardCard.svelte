<script lang="ts">
  /**
   * The third game over card: the map's leaderboard, eight rows, with the
   * player's own pending row highlighted. Tapping that row asks for the
   * keyboard.
   */
  import { t } from '@src/displays/enterprise/i18n'
  import BoardRow from './BoardRow.svelte'
  import type { LeaderboardRow } from './leaderboardRows'

  interface Props {
    rows: readonly LeaderboardRow[]
    mapId: string
    /** The board could not be loaded. */
    unavailable: boolean
    /** Whether the keyboard is up for the pending row. */
    editing: boolean
    onEdit: () => void
  }
  let { rows, mapId, unavailable, editing, onEdit }: Props = $props()
</script>

<section class="board">
  <h2 class="board__title">{$t.game.leaderboardTitle}</h2>
  {#if unavailable}
    <p class="board__unavailable">{$t.game.leaderboardUnavailable}</p>
  {:else}
    <ol class="board__rows">
      {#each rows as row (row.pending ? 'pending' : `${row.rank}-${row.name}`)}
        <BoardRow {row} {mapId} {editing} {onEdit} />
      {/each}
    </ol>
  {/if}
</section>

<style lang="sass">
  .board
    position: absolute
    inset: 0
    overflow: hidden
    box-sizing: border-box
    border-radius: 40px
    border: 0.6px solid rgba(255, 255, 255, 0.6)
    background: radial-gradient(ellipse 753px 634px at 50% -98.9px, #f1e7f8, rgba(255, 255, 255, 0)), linear-gradient(261.19deg, #fcf5f0 43.78%, #f9f9f9 91.31%)
    color: #010612

  .board__title
    position: absolute
    left: 0
    right: 0
    top: 38.5px
    margin: 0
    text-align: center
    font-family: var(--font-mozilla-text)
    font-weight: 700
    font-size: 38.4px

  .board__unavailable
    position: absolute
    left: 34.6px
    right: 34.6px
    top: 220px
    margin: 0
    text-align: center
    font-family: var(--font-mozilla-text)
    font-weight: 500
    font-size: 24px
    opacity: 0.6

  .board__rows
    position: absolute
    left: 34.6px
    top: 127.5px
    width: 322px
    margin: 0
    padding: 0
    list-style: none
    display: flex
    flex-direction: column
    gap: 8px
</style>
