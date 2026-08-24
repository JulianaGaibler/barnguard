<!-- Standalone leaderboard viewer, opened from a game's menu. A game whose modes
     do not compare keeps one board per mode and passes several; the switcher
     only appears past one. -->
<script lang="ts">
  import Overlay from '@src/core/ui/Overlay.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import Button from '@src/core/ui/Button.svelte'
  import IconButton from '@src/core/ui/IconButton.svelte'
  import {
    fetchLeaderboard,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import type { LeaderboardBoard } from '../games/GameModule'
  import { t } from '../i18n'
  import LeaderboardList from './LeaderboardList.svelte'
  import LeaderboardIcon from './LeaderboardIcon.svelte'
  import closeIconRaw from '@src/assets/icons/close-16.svg?raw'

  interface Props {
    /** The game's boards, primary first. */
    boards: readonly LeaderboardBoard[]
    onClose: () => void
  }
  const { boards, onClose }: Props = $props()

  /**
   * Rows the list makes room for, whether or not it has them.
   *
   * The board arrives over the network and a segment switch fetches again, so a
   * list sized to its contents would open small, jump when the rows land, and
   * collapse again on every switch. This is the height it holds instead, and
   * the number of placeholders it draws while it waits. Past this the list
   * scrolls rather than growing.
   */
  const VISIBLE_ROWS = 8

  /**
   * Null until a segment is tapped, which is what makes the primary the
   * default.
   */
  let picked = $state<string | null>(null)
  const selected = $derived(picked ?? boards[0]?.id ?? '')
  let entries = $state<LeaderboardEntry[]>([])
  let loading = $state(true)
  /**
   * The fetch failed, so the board's contents are unknown. Distinct from an
   * empty board: "no scores yet" would be a claim about the board that a
   * request which never arrived cannot support.
   */
  let unreachable = $state(false)

  /**
   * Guards against an out-of-order response. `fetchLeaderboard` carries its own
   * timeout and takes no caller signal, so switching boards twice can land the
   * first board's rows on top of the second's.
   */
  let generation = 0

  $effect(() => {
    const id = selected
    // No board to read. Settle on the empty notice rather than on placeholder
    // rows that nothing will ever replace.
    if (!id) {
      loading = false
      return
    }
    const mine = ++generation
    loading = true
    fetchLeaderboard(id, 50)
      .then((e) => {
        if (mine !== generation) return
        entries = e
        unreachable = false
      })
      .catch(() => {
        if (mine !== generation) return
        entries = []
        unreachable = true
      })
      .finally(() => {
        if (mine === generation) loading = false
      })
  })
</script>

<Overlay scrim center class="lb-overlay" onscrimclick={onClose}>
  <div class="lb-frame">
    <!-- Plain spacer: no background of its own, so the frame's own gradient
         (its `background`, painted once) shows through as the "header".
         No second gradient paint to keep in sync with the border's. -->
    <div class="lb__header"></div>
    <div class="lb__close">
      <IconButton
        label={$t.arcade.leaderboard.close}
        tone="surface"
        onclick={onClose}
      >
        <span class="lb__close-icon">{@html closeIconRaw}</span>
      </IconButton>
    </div>
    <div class="lb__badge">
      <LeaderboardIcon size={48} gold />
    </div>
    <Surface tone="light" radius="panel" class="lb__surface">
      <div class="lb__body">
        <h2 class="lb__title">{$t.arcade.leaderboard.title}</h2>
        {#if boards.length > 1}
          <div
            class="lb__boards"
            role="radiogroup"
            aria-label={$t.arcade.leaderboard.title}
          >
            {#each boards as board (board.id)}
              <Button
                small
                variant="secondary"
                toggled={board.id === selected}
                onclick={() => (picked = board.id)}
              >
                {board.label}
              </Button>
            {/each}
          </div>
        {/if}
        <div
          class="lb__list"
          class:lb__list--notice={!loading &&
            (unreachable || entries.length === 0)}
          style="--lb-visible-rows: {VISIBLE_ROWS}"
        >
          {#if !loading && unreachable}
            <p class="lb__unavailable" role="alert">
              {$t.arcade.leaderboard.unavailable}
            </p>
          {:else}
            <LeaderboardList {entries} {loading} skeletonRows={VISIBLE_ROWS} />
          {/if}
        </div>
      </div>
    </Surface>
  </div>
</Overlay>

<style lang="sass">
  :global(.overlay.lb-overlay.scrim)
    background: rgba(0, 0, 0, 0.45)

  .lb-frame
    // Above the Overlay's full-screen scrim-dismiss button, which would
    // otherwise sit on top of this and swallow every click (see HowToPlay's
    // `.htp` for the same fix).
    position: relative
    z-index: 1
    display: flex
    flex-direction: column
    padding: 3px
    border-radius: var(--radius-panel)
    // The one and only gradient paint: the thin 3px margin around `Surface`
    // reads as a border, and the `.lb__header` spacer (no fill of its own)
    // exposes the same paint above it as the "header" band.
    background: var(--color-gradient-leaderboard-border)
    // Concentric with the outer radius: inner corner = outer corner - padding.
    --surface-radius-override: calc(var(--radius-panel) - 3px)
    max-width: 92vw
    width: 32rem
    --lb-header-h: 5.5rem
    --lb-badge-size: 5.5rem

  .lb__close-icon
    display: inline-flex
    :global(svg)
      width: 20px
      height: 20px
      fill: currentColor
      display: block

  .lb__header
    flex-shrink: 0
    height: var(--lb-header-h)

  .lb__close
    position: absolute
    inset-block-start: var(--space-16)
    inset-inline-end: var(--space-16)
    // Above `.lb__badge`, which sits later in the DOM and could otherwise
    // paint over this if the two ever overlapped.
    z-index: 1

  // Same fill as the body behind it, straddling the header/body seam. Reads
  // as a notch cut into the header without any masking.
  .lb__badge
    position: absolute
    inset-inline: 0
    inset-block-start: calc(var(--lb-header-h) - var(--lb-badge-size) / 2)
    margin-inline: auto
    width: var(--lb-badge-size)
    height: var(--lb-badge-size)
    border-radius: var(--radius-pill)
    background: var(--color-surface-card)
    box-shadow: 0 0 0 var(--space-8) color-mix(in srgb, var(--color-surface-card) 50%, transparent)
    display: flex
    align-items: center
    justify-content: center

  .lb-frame :global(.lb__surface)
    box-shadow: none

  .lb__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding: var(--space-24)
    padding-block-start: calc(var(--lb-badge-size) / 2 + var(--space-16))

  .lb__title
    margin: 0
    @include tint.type-class(headline)
    color: var(--color-text)

  .lb__boards
    display: flex
    gap: var(--space-8)
    flex-wrap: wrap
    justify-content: center

  // A window onto the board rather than a box that takes its size from it. The
  // row pitch is `LeaderboardList`'s own: a row is at least `--space-48` tall
  // and the gap between two is `--space-4`, with no gap after the last.
  .lb__list
    width: 100%
    height: calc(var(--lb-visible-rows) * (var(--space-48) + var(--space-4)) - var(--space-4))
    // Short screens win over the row count.
    max-height: 50vh
    overflow-y: auto

  // Hands the whole reserved height to whatever stands in for the rows, which
  // centers itself in it. A block child would only be as tall as its one line.
  .lb__list--notice
    display: grid

  .lb__unavailable
    margin: 0
    align-self: center
    text-align: center
    padding: var(--space-24)
    color: var(--color-text-secondary)
</style>
