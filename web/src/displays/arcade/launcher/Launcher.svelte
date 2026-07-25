<script lang="ts">
  import { onMount } from 'svelte'
  import arcadeLogo from '@src/displays/arcade/assets/arcade-logo.svg?url'
  import { GAMES } from '@src/displays/arcade/games/registry'
  import type { GameModule } from '@src/displays/arcade/games/GameModule'
  import { fetchLeaderboard, type LeaderboardEntry } from '@src/core/leaderboard/leaderboardClient'
  import GameCard from './GameCard.svelte'

  interface Props {
    onPlay: (game: GameModule) => void
  }
  const { onPlay }: Props = $props()

  // `null` until its fetch resolves; `GameCard` reserves the badge's space
  // for every entry in this map so a late-arriving score never shifts layout.
  let topEntries = $state<Record<string, LeaderboardEntry | null>>(
    Object.fromEntries(
      GAMES.filter((g) => g.meta.supportsLeaderboard).map((g) => [g.meta.id, null]),
    ),
  )

  onMount(() => {
    for (const game of GAMES) {
      if (!game.meta.supportsLeaderboard) continue
      fetchLeaderboard(game.meta.id, 1)
        .then(([entry]) => {
          topEntries = { ...topEntries, [game.meta.id]: entry ?? null }
        })
        .catch(() => {})
    }
  })

  let trackEl = $state<HTMLDivElement>()
  // Mouse-only drag-to-scroll: touch already scrolls natively via
  // `overflow-x: auto`, and adding our own handling on top of it would double
  // up with (and likely fight) the browser's native touch/momentum scrolling.
  //
  // Capture only starts once the pointer actually moves past `DRAG_THRESHOLD`
  // — capturing eagerly on every pointerdown redirects the eventual click to
  // the track instead of whatever was under the cursor, silently swallowing
  // clicks on the card buttons beneath it.
  const DRAG_THRESHOLD_PX = 4
  let drag: {
    pointerId: number
    startX: number
    startScrollLeft: number
    dragging: boolean
  } | null = null

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || !trackEl) return
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: trackEl.scrollLeft,
      dragging: false,
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId || !trackEl) return
    const dx = e.clientX - drag.startX
    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      drag.dragging = true
      trackEl.setPointerCapture(e.pointerId)
    }
    trackEl.scrollLeft = drag.startScrollLeft - dx
  }

  function endDrag(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return
    drag = null
  }
</script>

<div class="launcher">
  <header class="launcher__header">
    <img class="launcher__logo" src={arcadeLogo} alt="Arcade" />
  </header>

  <div class="launcher__viewport">
    <div
      class="launcher__track"
      bind:this={trackEl}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      role="group"
      aria-roledescription="carousel"
    >
      {#each GAMES as game (game.meta.id)}
        <div class="launcher__slot">
          <GameCard
            {game}
            {onPlay}
            topEntry={game.meta.supportsLeaderboard ? topEntries[game.meta.id] : undefined}
          />
        </div>
      {/each}
    </div>
  </div>
</div>

<style lang="sass">
  .launcher
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    justify-content: center
    // Cards read against the engine background; only the track (and the cards
    // in it) capture pointer events.
    pointer-events: none
    --launcher-card-w: 22rem

  .launcher__header
    position: absolute
    inset-block-start: var(--space-48)
    inset-inline-start: var(--space-48)
    display: flex
    flex-direction: column
    gap: var(--space-4)

  .launcher__logo
    height: 4.5rem
    width: auto

  .launcher__viewport
    position: relative
    width: 100%

  .launcher__track
    // Grid (one implicit row, one column per card) rather than flex: every
    // card becomes as tall as the tallest one for free, via the row's own
    // height — `align-items: stretch` (the grid default) then hands that
    // height down to each `.launcher__slot`, which `.game-card` fills (see
    // its own `height: 100%`).
    display: grid
    grid-auto-flow: column
    grid-auto-columns: var(--launcher-card-w)
    gap: var(--space-32)
    overflow-x: auto
    overflow-y: hidden
    scroll-snap-type: x mandatory
    scroll-behavior: smooth
    // Leading/trailing space so the first and last cards can reach center —
    // same trick as the "how to play" carousel.
    padding-inline: calc((100% - var(--launcher-card-w)) / 2)
    // Generous enough to clear the card's own box-shadow (0 0.5rem 2.5rem) —
    // `overflow-y: hidden` below would otherwise clip it.
    padding-block: var(--space-48)
    scrollbar-width: none
    cursor: grab
    user-select: none
    // Re-enable interaction for the track (and the cards inside it).
    pointer-events: auto

    &::-webkit-scrollbar
      display: none

    &:active
      cursor: grabbing

  .launcher__slot
    scroll-snap-align: center
</style>
