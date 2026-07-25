<script lang="ts">
  import { get } from 'svelte/store'
  import { t } from '@src/i18n'
  import {
    deleteGame,
    gamesLive,
    type GameRecord,
  } from '@src/core/game-log/gameLogClient'
  import { enqueuePrint, printerLive } from '@src/core/print/printerClient'
  import { activeDisplay } from '@src/core/display'
  import { DebugSection, DraggableWindow } from '@src/stargazer/debug/ui'
  import ConfirmButton, {
    createConfirmCoordinator,
  } from '@src/core/ui/ConfirmButton.svelte'
  import {
    gamesPanelVisible,
    toggleGamesPanel,
  } from '@src/core/attendant/boothMenuToggle'

  const PAGE_SIZE = 20
  let nowTick = $state(Date.now())
  let page = $state(0) // 0-indexed

  // The log holds every display's games; only show the currently active
  // display's own games here (arcade sees only arcade games, stallwaechter
  // only stallwaechter games, etc).
  const displayGames = $derived(
    $gamesLive.games.filter((g) => g.display === $activeDisplay?.id),
  )
  const totalPages = $derived(
    Math.max(1, Math.ceil(displayGames.length / PAGE_SIZE)),
  )
  // Clamp back onto the last page if it disappears out from under us (e.g. a
  // delete/wipe shrinks the list while viewing a later page).
  $effect(() => {
    if (page > totalPages - 1) page = totalPages - 1
  })
  const paged = $derived(
    displayGames.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
  )

  function prevPage(): void {
    page = Math.max(0, page - 1)
  }
  function nextPage(): void {
    page = Math.min(totalPages - 1, page + 1)
  }

  function timeAgo(tsMs: number, nowMs: number): string {
    const seconds = Math.max(0, Math.floor((nowMs - tsMs) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  // Tick "time ago" every 30s while the panel is open.
  $effect(() => {
    if (!$gamesPanelVisible) return
    const id = setInterval(() => {
      nowTick = Date.now()
    }, 30_000)
    return () => clearInterval(id)
  })

  // Cross-button exclusive arming: arming any print / delete button disarms
  // whichever other confirm button was previously armed. Every
  // `<ConfirmButton>` below opts in by passing the same coordinator.
  const confirmGroup = createConfirmCoordinator()

  function handleDelete(g: GameRecord): void {
    deleteGame(g.id).catch((e: unknown) => {
      console.warn('[games-panel] failed to delete game', e)
    })
  }

  async function handleReprint(g: GameRecord): Promise<void> {
    const display = get(activeDisplay)
    if (!display?.renderLabelForRecord) return
    try {
      const tapeWidthMm = get(printerLive).printer?.tapeWidthMm
      const blob = await display.renderLabelForRecord(g, {
        messages: get(t),
        tapeWidthMm,
      })
      const { reprintMeta } = display.formatGameRecord(g)
      await enqueuePrint(blob, { ...reprintMeta, source: 'reprint' })
    } catch (err) {
      console.warn('[games-panel] reprint failed', err)
    }
  }
</script>

<DraggableWindow
  visible={$gamesPanelVisible}
  title="Games"
  storageId="barnguard-window-games-panel"
  spawnedBy="barnguard-window-booth-menu"
  side="left"
  width={400}
  onClose={toggleGamesPanel}
>
  <DebugSection title={`Recent games (${displayGames.length})`} open>
    <div class="debug-list">
      {#each paged as g (g.id)}
        {@const summary = $activeDisplay?.formatGameRecord(g)}
        <div class="debug-list-item">
          <span class="game-line">
            {#if summary}
              <span class="game-state">{summary.label}</span>
            {/if}
            {#if summary?.playerName}
              <span class="game-player" title="Saved to the leaderboard as">
                {summary.playerName.toUpperCase()}
              </span>
            {/if}
            <span class="game-score">
              {g.score}
              {#if summary?.highScore === 'overall'}
                <span class="game-star" title="was overall high">★</span>
              {:else if summary?.highScore === 'category'}
                <span class="game-star" title="was category high">☆</span>
              {/if}
            </span>
            <span class="game-meta"
              >{(g.durationMs / 1000).toFixed(0)}s · {timeAgo(g.tsMs, nowTick)} ago</span
            >
          </span>
          <span class="game-actions">
            {#if summary?.printable}
              <ConfirmButton
                label="Print"
                armedLabel="Confirm"
                title="Reprint badge"
                coordinator={confirmGroup}
                onConfirm={() => handleReprint(g)}
              />
            {/if}
            <ConfirmButton
              label="Del"
              armedLabel="Confirm"
              title="Delete this entry"
              coordinator={confirmGroup}
              onConfirm={() => handleDelete(g)}
            />
          </span>
        </div>
      {:else}
        <div class="empty-state">
          {$gamesLive.connected ? 'no games yet' : 'connecting…'}
        </div>
      {/each}
    </div>

    <div class="debug-row pagination-row">
      <button
        type="button"
        class="debug-btn"
        disabled={page === 0}
        onclick={prevPage}
      >
        ‹ Prev
      </button>
      <span class="label">Page {page + 1} of {totalPages}</span>
      <button
        type="button"
        class="debug-btn"
        disabled={page >= totalPages - 1}
        onclick={nextPage}
      >
        Next ›
      </button>
    </div>
  </DebugSection>
</DraggableWindow>

<style lang="sass">
  // Row internals for a recent-games entry. Container chrome (list, item,
  // empty-state, buttons) comes from debug-ui.sass.

  .pagination-row
    justify-content: center
    gap: 10px

    .debug-btn:disabled
      opacity: 0.4
      cursor: default

  .game-line
    display: flex
    align-items: baseline
    gap: 6px
    flex-wrap: wrap
    min-width: 0

  .game-state
    font-weight: 600
    letter-spacing: 0.04em

  .game-player
    font-weight: 600
    letter-spacing: 0.06em
    opacity: 0.75

  .game-score
    font-weight: 700
    color: #dbeafe

  .game-star
    margin-left: 2px
    color: #f5c26b

  .game-meta
    opacity: 0.6
    word-break: break-word

  .game-actions
    display: flex
    gap: 4px
    flex-shrink: 0
</style>
