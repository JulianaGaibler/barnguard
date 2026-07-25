<!-- Ranked place/name/score rows, shared by the standalone modal and the
     game-over rank preview. `pending` (not yet saved) is spliced into its
     sorted position and shown with a placeholder while its name is empty. -->
<script lang="ts">
  import type { LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'
  import { formatScore } from './formatScore'
  import { t } from '../i18n'

  export interface PendingRow {
    name: string
    score: number
    /** Overrides how the name renders (e.g. a live "Y A I _ _" while the
     * keyboard is open). Falls back to `name`/the placeholder when unset. */
    display?: string
  }

  export interface PendingAction {
    label: string
    onClick: () => void
  }

  interface Props {
    entries: LeaderboardEntry[]
    pending?: PendingRow | null
    /** Renders the pending row as a CTA pill instead of its score. */
    pendingAction?: PendingAction | null
    maxRows?: number
    /** Show only this many rows above/below the pending row. Omit for the
     * full list from rank 1 (the standalone leaderboard modal). */
    contextRows?: number
  }
  const {
    entries,
    pending = null,
    pendingAction = null,
    maxRows = 50,
    contextRows,
  }: Props = $props()

  interface Row {
    place: number
    name: string
    score: number
    pending: boolean
  }

  /** A `contextRows`-radius window centered on the pending row, shifted
   * (not shrunk) when that would run past either end of `all`. */
  function windowAround(all: Row[], radius: number): Row[] {
    const idx = all.findIndex((r) => r.pending)
    if (idx === -1) return all
    let start = idx - radius
    let end = idx + radius + 1
    if (start < 0) {
      end = Math.min(all.length, end - start)
      start = 0
    } else if (end > all.length) {
      start = Math.max(0, start - (end - all.length))
      end = all.length
    }
    return all.slice(start, end)
  }

  const rows = $derived.by<Row[]>(() => {
    const base: Array<{ name: string; score: number; pending: boolean }> = entries.map((e) => ({
      name: e.name,
      score: e.score,
      pending: false,
    }))
    if (pending) {
      const insertAt = base.findIndex((r) => pending.score > r.score)
      base.splice(insertAt === -1 ? base.length : insertAt, 0, {
        name: pending.name,
        score: pending.score,
        pending: true,
      })
    }
    const capped = base.slice(0, maxRows).map((r, i) => ({ place: i + 1, ...r }))
    return contextRows === undefined ? capped : windowAround(capped, contextRows)
  })
</script>

{#snippet rowContent(row: Row)}
  <span class="place">{row.place}</span>
  <span class="name">
    {#if row.pending && pending?.display}
      {pending.display}
    {:else}
      {row.name ? row.name.toUpperCase() : '______'}
    {/if}
  </span>
  {#if row.pending && pendingAction?.label}
    <span class="cta">{pendingAction.label}</span>
  {:else}
    <span class="score">{formatScore(row.score)}</span>
  {/if}
{/snippet}

<ol class="board">
  {#each rows as row (row.place)}
    <li>
      {#if row.pending && pendingAction}
        <button type="button" class="row pending" onclick={pendingAction.onClick}>
          {@render rowContent(row)}
        </button>
      {:else}
        <div class="row" class:pending={row.pending}>
          {@render rowContent(row)}
        </div>
      {/if}
    </li>
  {/each}
  {#if rows.length === 0}
    <li class="empty">{$t.arcade.leaderboard.empty}</li>
  {/if}
</ol>

<style lang="sass">
  .board
    display: flex
    flex-direction: column
    gap: var(--space-4)
    list-style: none
    width: 100%
    min-height: 8rem
    overflow-x: hidden

  .row
    display: grid
    // `minmax(0, 1fr)`, not bare `1fr` — an `fr` track's automatic minimum is
    // still its content's min-content size unless floored to 0, so without
    // this the name column was refusing to shrink and blowing out the row.
    grid-template-columns: 2.5rem minmax(0, 1fr) auto
    align-items: center
    gap: var(--space-12)
    padding: var(--space-8) var(--space-12)
    // No global border-box reset in this codebase — without this, the
    // padding above adds onto the 100% width instead of being cut from it,
    // overflowing the row past its container by exactly that padding.
    box-sizing: border-box
    // Keeps every row the same height regardless of whether it's showing the
    // CTA pill (which adds its own padding) or plain text.
    min-height: var(--space-48)
    border-radius: var(--radius-input)
    width: 100%
    border: none
    background: none
    font: inherit
    color: inherit
    text-align: inherit

  // The whole tinted area is the tap target for opening the keyboard, not
  // just the pill inside it — a `<button>` in place of the plain `<div>`.
  button.row
    cursor: pointer

    &:active
      filter: brightness(0.97)

  .row.pending
    background: color-mix(in srgb, var(--color-accent) 12%, transparent)
    border: 1px solid var(--color-accent)
    border-radius: var(--radius-pill)

  .place
    color: var(--color-text-secondary)
    font-variant-numeric: tabular-nums
    text-align: right

  .name
    min-width: 0
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    text-align: start
    font-weight: 800
    letter-spacing: 0.15em

  .score
    min-width: 2ch
    text-align: end
    font-weight: 800
    font-variant-numeric: tabular-nums
    margin-inline-end: var(--space-40)

  .cta
    justify-self: end
    border-radius: var(--radius-pill)
    padding-inline: var(--space-16)
    padding-block: var(--space-8)
    background: var(--color-action-primary)
    color: var(--color-action-primary-text)
    @include tint.type-class(ui-small-bold)

  .empty
    color: var(--color-text-secondary)
    text-align: center
    padding: var(--space-24)
</style>
