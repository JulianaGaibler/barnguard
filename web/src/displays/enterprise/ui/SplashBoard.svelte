<script lang="ts">
  /**
   * The map's top three in the splash's top right corner, on a glass card like
   * the game over score card. The board and the high scores are fetched each
   * time the splash comes up, so a map best nobody named heads the card as it
   * heads the game over board. The card stays away while nobody has put a name
   * on the board, while the backend is unreachable, or while an attendant has
   * switched it off. A reconnect fetches the board again. Tapping the card
   * opens the whole board over the splash.
   */
  import { onDestroy } from 'svelte'
  import type { Engine } from 'stargazer'
  import { fetchLeaderboard } from '@src/core/leaderboard/leaderboardClient'
  import { printerLive } from '@src/core/print/printerClient'
  import { onReconnect } from '@src/core/print/reconnect'
  import { t } from '@src/displays/enterprise/i18n'
  import { fetchEnterpriseHighScores } from '@src/displays/enterprise/game-log'
  import { splashBoardEnabled } from '@src/displays/enterprise/attendant/splashBoard'
  import BoardRow from './BoardRow.svelte'
  import SplashFullBoard from './SplashFullBoard.svelte'
  import {
    boardDisplay,
    leaderboardRows,
    mapBest,
    type LeaderboardRow,
  } from './leaderboardRows'
  import { Reveal } from '@src/core/ui/reveal.svelte'

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
  let open = $state(false)

  $effect(() => {
    if (!active) return
    let latest = 0
    const load = (): void => {
      const request = ++latest
      // Without the high scores the card still shows the named top three.
      const best = fetchEnterpriseHighScores()
        .then((scores) => mapBest(scores, mapId))
        .catch(() => null)
      Promise.all([fetchLeaderboard(boardDisplay(mapId), SHOWN), best])
        .then(([entries, best]) => {
          if (request !== latest) return
          rows =
            entries.length > 0
              ? leaderboardRows(entries, null, best, SHOWN)
              : []
        })
        .catch(() => {
          if (request === latest) rows = []
        })
    }
    load()
    const unwatch = onReconnect(printerLive, load)
    return () => {
      latest = -1
      unwatch()
    }
  })

  $effect(() => {
    if (!active) open = false
  })

  $effect(() => {
    const online = $printerLive.connection === 'online'
    if (active && online && $splashBoardEnabled && rows.length > 0) {
      reveal.show()
    } else void reveal.hide()
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
    <button
      class="board__hit"
      aria-label={$t.game.leaderboardTitle}
      onclick={() => (open = true)}
    ></button>
  </section>
{/if}

{#if open}
  <SplashFullBoard {mapId} onClose={() => (open = false)} />
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
    pointer-events: auto

  // The whole card is the tap target, over its rows.
  .board__hit
    position: absolute
    inset: 0
    appearance: none
    border: 0
    padding: 0
    background: transparent
    border-radius: inherit
    cursor: pointer

  .board__rows
    margin: 0
    padding: 0
    list-style: none
    display: flex
    flex-direction: column
    gap: 8px
</style>
