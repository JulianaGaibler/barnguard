<script lang="ts">
  import { get } from 'svelte/store'
  import { t } from '@src/i18n'
  import {
    clearGames,
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
  import { gamesPanelVisible, toggleGamesPanel } from '@src/core/attendant/boothMenuToggle'

  const RECENT_MAX = 10
  let nowTick = $state(Date.now())
  const recent = $derived($gamesLive.games.slice(0, RECENT_MAX))

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

  // Cross-button exclusive arming: arming any print / delete / wipe button
  // disarms whichever other confirm button was previously armed. Every
  // `<ConfirmButton>` below opts in by passing the same coordinator.
  const confirmGroup = createConfirmCoordinator()

  function handleWipe(): void {
    clearGames().catch((e: unknown) => {
      console.warn('[games-panel] failed to clear games', e)
    })
  }

  function handleDelete(g: GameRecord): void {
    deleteGame(g.id).catch((e: unknown) => {
      console.warn('[games-panel] failed to delete game', e)
    })
  }

  async function handleReprint(g: GameRecord): Promise<void> {
    const display = get(activeDisplay)
    if (!display) return
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
  width={280}
  onClose={toggleGamesPanel}
>
  <DebugSection title={`Recent games (${recent.length})`} open>
    <div class="debug-list">
      {#each recent as g (g.id)}
        {@const summary = $activeDisplay?.formatGameRecord(g)}
        <div class="debug-list-item">
          <span class="game-line">
            {#if summary}
              <span class="game-state">{summary.label}</span>
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
            <ConfirmButton
              label="Print"
              armedLabel="Confirm"
              title="Reprint badge"
              coordinator={confirmGroup}
              onConfirm={() => handleReprint(g)}
            />
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

    <div class="debug-row">
      <span class="label">High scores</span>
      <ConfirmButton
        label="Wipe all"
        armedLabel="Tap again to wipe"
        coordinator={confirmGroup}
        onConfirm={handleWipe}
      />
    </div>
  </DebugSection>
</DraggableWindow>

<style lang="sass">
  // Row internals for a recent-games entry. Container chrome (list, item,
  // empty-state, buttons) comes from debug-ui.sass.

  .game-line
    display: flex
    align-items: baseline
    gap: 6px
    flex-wrap: wrap
    min-width: 0

  .game-state
    font-weight: 600
    letter-spacing: 0.04em

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
