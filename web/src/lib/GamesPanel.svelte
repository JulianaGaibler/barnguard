<script lang="ts">
  import { get } from 'svelte/store'
  import { t } from '@src/i18n'
  import {
    clearGames,
    deleteGame,
    fetchHighScores,
    gamesLive,
    type GameRecord,
  } from '@src/lib/gameLogClient'
  import { enqueuePrint, printerLive } from '@src/lib/print/printerClient'
  import {
    renderLabel,
    squarePxFrom,
    type LabelInput,
  } from '@src/lib/print/labelRenderer'
  import type { StateId } from '@src/game/data/states'
  import { DebugSection, DraggableWindow } from '@src/stargazer/debug/ui'
  import ConfirmButton, {
    createConfirmCoordinator,
  } from './ConfirmButton.svelte'
  import { gamesPanelVisible, toggleGamesPanel } from './boothMenuToggle'

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
    try {
      const highScores = await fetchHighScores()
      const input: LabelInput = {
        reason: g.reason === 'exited_germany' ? 'exitedGermany' : 'collision',
        stateId: g.stateId as StateId,
        score: g.score,
        isOverallHigh: g.wasOverallHigh,
        isStateHigh: g.wasStateHigh,
        highScores,
        escapeHeadingRad: g.escapeHeadingRad,
        printedAt: new Date(),
      }
      const tapeWidthMm = get(printerLive).printer?.tapeWidthMm
      const blob = await renderLabel(input, {
        messages: get(t),
        size: squarePxFrom(tapeWidthMm),
      })
      await enqueuePrint(blob, {
        stateId: g.stateId,
        score: g.score,
        highScore: g.wasOverallHigh || g.wasStateHigh,
        source: 'reprint',
      })
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
        <div class="debug-list-item">
          <span class="game-line">
            <span class="game-state">{g.stateId.toUpperCase()}</span>
            <span class="game-score">
              {g.score}
              {#if g.wasOverallHigh}
                <span class="game-star" title="was overall high">★</span>
              {:else if g.wasStateHigh}
                <span class="game-star" title="was state high">☆</span>
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
