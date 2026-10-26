<script lang="ts">
  /**
   * The map's whole leaderboard over the splash, on the same glass as the
   * corner card. The rows scroll, and the close button below them stays in
   * place. Tapping outside the panel closes it too. The board is fetched when
   * the panel opens.
   */
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { fetchLeaderboard } from '@src/core/leaderboard/leaderboardClient'
  import { t } from '@src/displays/enterprise/i18n'
  import { fetchEnterpriseHighScores } from '@src/displays/enterprise/game-log'
  import BoardRow from './BoardRow.svelte'
  import {
    boardDisplay,
    leaderboardRows,
    mapBest,
    type LeaderboardRow,
  } from './leaderboardRows'

  interface Props {
    mapId: string
    onClose: () => void
  }
  let { mapId, onClose }: Props = $props()

  /** Rows the server keeps, plus the unnamed map best that may head them. */
  const ALL_ROWS = 51

  let rows = $state<LeaderboardRow[]>([])
  let unavailable = $state(false)

  onMount(() => {
    let cancelled = false
    // Without the high scores the board still lists the named entries.
    const best = fetchEnterpriseHighScores()
      .then((scores) => mapBest(scores, mapId))
      .catch(() => null)
    Promise.all([fetchLeaderboard(boardDisplay(mapId)), best])
      .then(([entries, best]) => {
        if (!cancelled) rows = leaderboardRows(entries, null, best, ALL_ROWS)
      })
      .catch(() => {
        if (!cancelled) unavailable = true
      })
    return () => (cancelled = true)
  })
</script>

<div class="full" transition:fade={{ duration: 200 }}>
  <button class="full__scrim" aria-label={$t.game.closeButton} onclick={onClose}
  ></button>
  <section class="full__panel" aria-label={$t.game.leaderboardTitle}>
    <h2 class="full__title">{$t.game.leaderboardTitle}</h2>
    {#if unavailable}
      <p class="full__unavailable">{$t.game.leaderboardUnavailable}</p>
    {:else}
      <ol class="full__rows">
        {#each rows as row (`${row.rank}-${row.name}`)}
          <BoardRow {row} {mapId} />
        {/each}
      </ol>
    {/if}
    <button class="full__close" onclick={onClose}>{$t.game.closeButton}</button>
  </section>
</div>

<style lang="sass">
  .full
    position: absolute
    inset: 0
    pointer-events: auto

  .full__scrim
    position: absolute
    inset: 0
    appearance: none
    border: 0
    padding: 0
    background: rgba(1, 6, 18, 0.35)
    cursor: pointer

  .full__panel
    position: absolute
    top: 50%
    left: 50%
    width: 520px
    min-height: min(480px, calc(100% - 96px))
    max-height: calc(100% - 96px)
    transform: translate(-50%, -50%)
    box-sizing: border-box
    display: flex
    flex-direction: column
    gap: 24px
    padding: 32px 32px 28px
    border-radius: 40px
    border: 2px solid rgba(255, 255, 255, 0.6)
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.86) 10.17%, rgba(255, 255, 255, 0.74) 57.52%, rgba(255, 255, 255, 0.78))
    backdrop-filter: blur(13.2px)
    color: #010612

  .full__title
    margin: 0
    text-align: center
    font-family: var(--font-mozilla-text)
    font-weight: 700
    font-size: 38.4px

  // Takes the panel's spare height, and scrolls once its rows pass it.
  .full__rows
    flex: 1 1 auto
    min-height: 0
    margin: 0
    padding: 0
    list-style: none
    display: flex
    flex-direction: column
    gap: 8px
    overflow-y: auto
    overscroll-behavior: contain
    touch-action: pan-y

  .full__unavailable
    flex: 1 1 0
    margin: 0
    text-align: center
    font-family: var(--font-mozilla-text)
    font-weight: 500
    font-size: 24px
    opacity: 0.6

  .full__close
    flex: none
    align-self: center
    appearance: none
    border: 0
    cursor: pointer
    padding: 16px 48px
    border-radius: 999px
    background: #15141a
    color: #ffffff
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: 40px
</style>
