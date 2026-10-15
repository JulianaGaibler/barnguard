<script lang="ts">
  /**
   * The map's top three in the splash's top right corner, on a glass card like
   * the game over score card. The board is fetched each time the splash comes
   * up, and the card stays away while nobody has put a name on it or an
   * attendant has switched it off.
   */
  import { onDestroy } from 'svelte'
  import type { Engine } from '@src/stargazer'
  import { fetchLeaderboard } from '@src/core/leaderboard/leaderboardClient'
  import { t } from '@src/displays/enterprise/i18n'
  import { splashBoardEnabled } from '@src/displays/enterprise/attendant/splashBoard'
  import BoardRow from './BoardRow.svelte'
  import {
    boardDisplay,
    leaderboardRows,
    type LeaderboardRow,
  } from './leaderboardRows'
  import { Reveal } from './reveal.svelte'

  interface Props {
    engine: Engine
    /** Whether the splash is showing. */
    active: boolean
    mapId: string
  }
  let { engine, active, mapId }: Props = $props()

  const SHOWN = 3
  /** The card at this fraction of the game over card's size. */
  const SCALE = 0.7

  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 1)
  let rows = $state<LeaderboardRow[]>([])

  $effect(() => {
    if (!active) return
    let stale = false
    fetchLeaderboard(boardDisplay(mapId), SHOWN)
      .then((entries) => {
        if (!stale) rows = leaderboardRows(entries, null, null, SHOWN)
      })
      .catch(() => {
        if (!stale) rows = []
      })
    return () => {
      stale = true
    }
  })

  $effect(() => {
    if (active && $splashBoardEnabled && rows.length > 0) reveal.show()
    else void reveal.hide()
  })

  onDestroy(() => reveal.destroy())
</script>

{#if reveal.visible}
  <section
    class="board"
    aria-label={$t.game.leaderboardTitle}
    style="opacity: {reveal.items[0].v}; transform: translateY({(1 -
      reveal.items[0].v) *
      -24}px) scale({SCALE})"
  >
    <ol class="board__rows">
      {#each rows as row (`${row.rank}-${row.name}`)}
        <BoardRow {row} {mapId} />
      {/each}
    </ol>
  </section>
{/if}

<style lang="sass">
  .board
    position: absolute
    top: 32px
    right: 32px
    width: 362px
    box-sizing: border-box
    padding: 20px
    border-radius: 40px
    border: 2px solid rgba(255, 255, 255, 0.6)
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 10.17%, rgba(255, 255, 255, 0.54) 57.52%, rgba(255, 255, 255, 0.58))
    backdrop-filter: blur(13.2px)
    color: #010612
    transform-origin: top right

  .board__rows
    margin: 0
    padding: 0
    list-style: none
    display: flex
    flex-direction: column
    gap: 8px
</style>
