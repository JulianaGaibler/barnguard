<script lang="ts">
  import { activeDisplay } from '@src/core/display'
  import {
    deleteLeaderboardEntry,
    fetchLeaderboard,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import { DebugSection, DraggableWindow } from '@src/stargazer/debug/ui'
  import ConfirmButton, {
    createConfirmCoordinator,
  } from '@src/core/ui/ConfirmButton.svelte'
  import {
    leaderboardPanelVisible,
    toggleLeaderboardPanel,
  } from '@src/core/attendant/boothMenuToggle'

  const MAX_ROWS = 50

  interface Row {
    place: number
    entry: LeaderboardEntry
  }

  // The leaderboard is scoped per arcade game, not per kiosk display — a
  // display can list several ids here (see `DisplayManifest.leaderboardIds`).
  // Rank stays per-game (each list is fetched and numbered independently);
  // `entry.display` carries the game id for the row label.
  let rows = $state<Row[]>([])
  let loading = $state(false)

  function refresh(): void {
    const ids = $activeDisplay?.leaderboardIds ?? []
    if (ids.length === 0) {
      rows = []
      return
    }
    loading = true
    Promise.all(ids.map((id) => fetchLeaderboard(id, MAX_ROWS)))
      .then((lists) => {
        rows = lists.flatMap((list) =>
          list.map((entry, i) => ({ place: i + 1, entry })),
        )
      })
      .catch(() => (rows = []))
      .finally(() => (loading = false))
  }

  // Refetch whenever the panel opens or the active display changes — no live
  // push for the leaderboard (see `leaderboardClient.ts`), so this is the
  // only trigger.
  $effect(() => {
    if ($leaderboardPanelVisible) refresh()
  })

  const showGameLabel = $derived(
    ($activeDisplay?.leaderboardIds?.length ?? 0) > 1,
  )
  const confirmGroup = createConfirmCoordinator()

  function handleDelete(entry: LeaderboardEntry): void {
    deleteLeaderboardEntry(entry.id)
      .then(refresh)
      .catch((e: unknown) => {
        console.warn('[leaderboard-panel] failed to delete entry', e)
      })
  }
</script>

<DraggableWindow
  visible={$leaderboardPanelVisible}
  title="Leaderboard"
  storageId="barnguard-window-leaderboard-panel"
  spawnedBy="barnguard-window-booth-menu"
  side="left"
  width={320}
  onClose={toggleLeaderboardPanel}
>
  <DebugSection title={`Leaderboard (${rows.length})`} open>
    <div class="debug-list max-height-300">
      {#each rows as row (row.entry.id)}
        <div class="debug-list-item">
          <span class="lb-line">
            <span class="lb-place">{row.place}</span>
            {#if showGameLabel}
              <span class="lb-game">{row.entry.display}</span>
            {/if}
            <span class="lb-name">{row.entry.name.toUpperCase()}</span>
            <span class="lb-score">{row.entry.score}</span>
          </span>
          <ConfirmButton
            label="Del"
            armedLabel="Confirm"
            title="Delete this entry"
            coordinator={confirmGroup}
            onConfirm={() => handleDelete(row.entry)}
          />
        </div>
      {:else}
        <div class="empty-state">
          {loading ? 'loading…' : 'no scores yet'}
        </div>
      {/each}
    </div>
  </DebugSection>
</DraggableWindow>

<style lang="sass">
  // Row internals; container chrome (list, item, empty-state, buttons) comes
  // from debug-ui.sass, same as GamesPanel.
  .lb-line
    display: flex
    align-items: baseline
    gap: 8px
    min-width: 0

  .lb-place
    opacity: 0.5

  .lb-game
    opacity: 0.55
    text-transform: uppercase
    font-size: 0.6875rem

  .lb-name
    font-weight: 600
    letter-spacing: 0.04em

  .lb-score
    font-weight: 700
    color: #dbeafe
</style>
