<script lang="ts">
  import { get } from 'svelte/store'
  import { locale, setLocale, t } from '@src/i18n'
  import {
    clearGames,
    deleteGame,
    fetchHighScores,
    gamesLive,
    type GameRecord,
  } from '@src/lib/gameLogClient'
  import {
    enqueuePrint,
    printerLive,
  } from '@src/lib/print/printerClient'
  import {
    renderLabel,
    squarePxFrom,
    type LabelInput,
  } from '@src/lib/print/labelRenderer'
  import type { StateId } from '@src/game/data/states'
  import {
    DebugSection,
    DraggableWindow,
    ToggleButton,
  } from '@src/stargazer/debug/ui'
  import {
    boothMenuState,
    closeBoothMenu,
    debugHudVisible,
    isFullscreen,
    printerPanelVisible,
    toggleDebugHud,
    toggleFullscreen,
    togglePrinterPanel,
  } from './boothMenuToggle'

  // Wipe scores uses a two-tap confirm; first tap arms, second tap fires.
  // Auto-disarms after a short window so it doesn't stay hot forever.
  let wipeArmed = $state(false)
  let wipeArmTimer: ReturnType<typeof setTimeout> | null = null

  function handleWipeScores(): void {
    if (wipeArmed) {
      clearGames().catch((e: unknown) => {
        console.warn('[booth-menu] failed to clear games', e)
      })
      wipeArmed = false
      if (wipeArmTimer !== null) clearTimeout(wipeArmTimer)
      wipeArmTimer = null
      return
    }
    wipeArmed = true
    if (wipeArmTimer !== null) clearTimeout(wipeArmTimer)
    wipeArmTimer = setTimeout(() => {
      wipeArmed = false
      wipeArmTimer = null
    }, 3000)
  }

  function handleReload(): void {
    location.reload()
  }

  // Recent games: show the newest ~10 with delete + reprint actions.
  // `gamesLive` is the SSE-driven mirror of the server log so this table stays
  // in sync without the operator having to reopen the panel.
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

  // Tick the "time ago" cells every 30s while the panel is open so the display
  // updates without a manual refresh. Cleared on close (or unmount).
  $effect(() => {
    if (!$boothMenuState.open) return
    const id = setInterval(() => {
      nowTick = Date.now()
    }, 30_000)
    return () => clearInterval(id)
  })

  // Per-row confirm: first tap arms, second tap fires. One armed action at a
  // time — tapping a different button (or the same one on a different row)
  // re-arms it and cancels the previous confirm. Matches the "Wipe" button's
  // two-tap dance so destructive/printing actions can't misfire.
  type Armed = { id: string; action: 'print' | 'delete' } | null
  let armed = $state<Armed>(null)
  let armTimer: ReturnType<typeof setTimeout> | null = null

  function armAction(id: string, action: 'print' | 'delete'): void {
    armed = { id, action }
    if (armTimer !== null) clearTimeout(armTimer)
    armTimer = setTimeout(() => {
      armed = null
      armTimer = null
    }, 3000)
  }

  function disarm(): void {
    armed = null
    if (armTimer !== null) clearTimeout(armTimer)
    armTimer = null
  }

  function isArmed(id: string, action: 'print' | 'delete'): boolean {
    return armed !== null && armed.id === id && armed.action === action
  }

  function handleDelete(g: GameRecord): void {
    if (!isArmed(g.id, 'delete')) {
      armAction(g.id, 'delete')
      return
    }
    disarm()
    deleteGame(g.id).catch((e: unknown) => {
      console.warn('[booth-menu] failed to delete game', e)
    })
  }

  async function handleReprint(g: GameRecord): Promise<void> {
    if (!isArmed(g.id, 'print')) {
      armAction(g.id, 'print')
      return
    }
    disarm()
    try {
      // The badge's ⭐ / high-score banner comes from the record's snapshotted
      // flags (`wasOverallHigh` / `wasStateHigh`) so reprints stay 1:1 with the
      // original — a badge that shipped with a star still reprints with its
      // star even if a later game surpassed the score. The "current best"
      // copy elsewhere on the label uses today's high-scores.
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
      console.warn('[booth-menu] reprint failed', err)
    }
  }
</script>

<DraggableWindow
  visible={$boothMenuState.open}
  title="Attendant Controls"
  storageId="barnguard-window-booth-menu"
  side={$boothMenuState.side}
  width={240}
  onClose={closeBoothMenu}
>
  <DebugSection title="System" open>
    <div class="debug-row">
      <span class="label">Language</span>
      <div class="row__actions">
        <button
          type="button"
          class="debug-btn"
          class:active={$locale === 'de'}
          onclick={() => setLocale('de')}
        >
          DE
        </button>
        <button
          type="button"
          class="debug-btn"
          class:active={$locale === 'en'}
          onclick={() => setLocale('en')}
        >
          EN
        </button>
      </div>
    </div>

    <ToggleButton
      active={$isFullscreen}
      onToggle={toggleFullscreen}
      label="Fullscreen"
    />

    <div class="debug-row">
      <span class="label">Page</span>
      <button type="button" class="debug-btn" onclick={handleReload}>
        Reload
      </button>
    </div>
  </DebugSection>

  <DebugSection title="Panels" open>
    <ToggleButton
      active={$printerPanelVisible}
      onToggle={togglePrinterPanel}
      label="Printer"
    />
    <ToggleButton
      active={$debugHudVisible}
      onToggle={toggleDebugHud}
      label="Stargazer (GFX)"
    />


    <div class="debug-row">
      <span class="label">High scores</span>
      <button
        type="button"
        class="debug-btn"
        class:danger={wipeArmed}
        onclick={handleWipeScores}
      >
        {wipeArmed ? 'Tap again to wipe' : 'Wipe'}
      </button>
    </div>
  </DebugSection>

  <DebugSection title={`Recent games (${recent.length})`}>
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
            <button
              type="button"
              class="debug-btn"
              class:danger={isArmed(g.id, 'print')}
              onclick={() => handleReprint(g)}
              title="Reprint badge">{isArmed(g.id, 'print') ? 'Confirm' : 'Print'}</button
            >
            <button
              type="button"
              class="debug-btn"
              class:danger={isArmed(g.id, 'delete')}
              onclick={() => handleDelete(g)}
              title="Delete this entry">{isArmed(g.id, 'delete') ? 'Confirm' : 'Del'}</button
            >
          </span>
        </div>
      {:else}
        <div class="empty-state">
          {$gamesLive.connected ? 'no games yet' : 'connecting…'}
        </div>
      {/each}
    </div>
  </DebugSection>
</DraggableWindow>

<style lang="sass">
  // Row layout, button chrome, active/danger variants, list container +
  // rows, and empty-state all come from the shared debug-ui.sass. Toggle
  // rows use the shared ToggleButton component. What lives here is only
  // the booth-specific bits: the multi-button cluster in the Language
  // row, and the per-cell typography inside a Recent-games row.

  .row__actions
    display: flex
    gap: 4px

  // Recent-games row internals. The row itself is a `.debug-list-item`, so
  // this styles what goes INSIDE — the label block on the left and the
  // action cluster on the right.
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
