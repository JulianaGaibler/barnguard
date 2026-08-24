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
    /**
     * Overrides how the name renders (e.g. a live "Y A I _ _" while the
     * keyboard is open). Falls back to `name`/the placeholder when unset.
     */
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
    /**
     * Ring the pending row, marking it as the one currently receiving keys.
     * Only meaningful where more than one list is on screen at a time (a
     * two-player game over), and off by default so every other caller is
     * unchanged.
     */
    focused?: boolean
    /**
     * Show only this many rows above/below the pending row. Omit for the full
     * list from rank 1 (the standalone leaderboard modal).
     */
    contextRows?: number
    /**
     * The board is still on its way. Held past {@link SKELETON_DELAY_MS} it
     * draws placeholder rows, which is what holds a caller's height while it
     * waits.
     */
    loading?: boolean
    /** How many placeholder rows a held `loading` draws. */
    skeletonRows?: number
  }
  const {
    entries,
    pending = null,
    pendingAction = null,
    maxRows = 50,
    focused = false,
    contextRows,
    loading = false,
    skeletonRows = 8,
  }: Props = $props()

  interface Row {
    place: number
    name: string
    score: number
    pending: boolean
  }

  /**
   * A `contextRows`-radius window centered on the pending row, shifted (not
   * shrunk) when that would run past either end of `all`.
   */
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

  /**
   * How long `loading` must hold before placeholder rows appear.
   *
   * The board is served from the booth's own machine and normally lands in a
   * few milliseconds. Drawing the skeleton for that long reads as a flash of
   * noise rather than as loading, so only a wait long enough to notice gets
   * placeholders; a quick one goes straight from nothing to rows.
   */
  const SKELETON_DELAY_MS = 250

  let held = $state(false)

  $effect(() => {
    if (!loading) {
      held = false
      return
    }
    const timer = setTimeout(() => (held = true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  })

  const skeleton = $derived([...Array(skeletonRows).keys()])

  const rows = $derived.by<Row[]>(() => {
    const base: Array<{ name: string; score: number; pending: boolean }> =
      entries.map((e) => ({
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
    const capped = base
      .slice(0, maxRows)
      .map((r, i) => ({ place: i + 1, ...r }))
    return contextRows === undefined
      ? capped
      : windowAround(capped, contextRows)
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

<ol
  class="board"
  class:board--empty={!loading && rows.length === 0}
  aria-busy={loading || undefined}
>
  {#if held}
    <!-- Nothing to read here, so the rows are hidden from the reader that
         `aria-busy` above has already told to wait. -->
    {#each skeleton as i (i)}
      <li aria-hidden="true">
        <div class="row skeleton" style="--skeleton-delay: {i * 90}ms">
          <span class="bar bar--place"></span>
          <span class="bar bar--name"></span>
          <span class="bar bar--score"></span>
        </div>
      </li>
    {/each}
  {:else if !loading}
    {#each rows as row (row.place)}
      <li>
        {#if row.pending && pendingAction}
          <button
            type="button"
            class="row pending"
            class:focused
            onclick={pendingAction.onClick}
          >
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

  // Nothing to rank yet, so the notice sits in the middle of whatever height
  // the caller has given the list rather than at the top of it.
  .board--empty
    justify-content: center

  .row
    display: grid
    // `minmax(0, 1fr)`, not bare `1fr`. An `fr` track's automatic minimum is
    // still its content's min-content size unless floored to 0, so without
    // this the name column was refusing to shrink and blowing out the row.
    grid-template-columns: 2.5rem minmax(0, 1fr) auto
    align-items: center
    gap: var(--space-12)
    padding: var(--space-8) var(--space-12)
    // No global border-box reset in this codebase. Without this, the
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
  // just the pill inside it, hence a `<button>` in place of the plain `<div>`.
  button.row
    cursor: pointer

    &:active
      filter: brightness(0.97)

  .row.pending
    background: color-mix(in srgb, var(--color-accent) 12%, transparent)
    border: 1px solid var(--color-accent)
    border-radius: var(--radius-pill)

  // The same ring the on-screen keyboard field wears when it is open, so a
  // focused row and a focused field read as one state.
  .row.pending.focused
    @include tint.effect-focus-base
    background: color-mix(in srgb, var(--color-accent) 24%, transparent)

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

  // Placeholder rows take the real grid, so a row lands exactly where its
  // placeholder was and only the text arrives.
  .bar
    block-size: var(--space-12)
    border-radius: var(--radius-pill)
    background: var(--color-border)
    // Staggered down the list, which reads as one list waking up rather than
    // as several rows blinking together.
    animation: skeleton-pulse 1400ms ease-in-out infinite
    animation-delay: var(--skeleton-delay, 0ms)

  .bar--place
    inline-size: 1.25rem
    justify-self: end

  .bar--name
    inline-size: 60%

  // Ends where a score ends, past the gutter the CTA pill needs.
  .bar--score
    inline-size: 3rem
    justify-self: end
    margin-inline-end: var(--space-40)

  @keyframes skeleton-pulse
    0%, 100%
      opacity: 1
    50%
      opacity: 0.4
</style>
