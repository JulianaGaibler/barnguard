<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import arcadeLogoRaw from '@src/displays/arcade/assets/arcade-logo.svg?raw'
  import { GAMES } from '@src/displays/arcade/games/registry'
  import type { GameModule } from '@src/displays/arcade/games/GameModule'
  import {
    fetchLeaderboard,
    type LeaderboardEntry,
  } from '@src/core/leaderboard/leaderboardClient'
  import GameCard from './GameCard.svelte'
  import LauncherFilters from './LauncherFilters.svelte'
  import { playerCountsAcross } from './playerCounts'
  import { boothDay, dailyOrder } from './gameOfTheDay'
  import { daemonConfig } from '@src/stores/daemonConfig'
  import { locationFromConfig } from '@src/displays/arcade/background/dayCycle'
  import { t } from '@src/displays/arcade/i18n'

  interface Props {
    onPlay: (game: GameModule) => void
  }
  const { onPlay }: Props = $props()

  // `null` until its fetch resolves. `GameCard` reserves the badge's space
  // for every entry in this map so a late-arriving score never shifts layout.
  let topEntries = $state<Record<string, LeaderboardEntry | null>>(
    Object.fromEntries(
      GAMES.filter((g) => g.meta.supportsLeaderboard).map((g) => [
        g.meta.id,
        null,
      ]),
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

  // How often the day is re-read. The booth runs unattended for months, which
  // rules out a single timer aimed at the next midnight: over that span it
  // drifts, and a suspend or a clock correction throws it off outright. A
  // re-read on the minute costs nothing, recovers from both on its own, and
  // puts the changeover within a minute of the booth's midnight.
  const DAY_POLL_MS = 60_000

  let nowMs = $state(Date.now())

  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), DAY_POLL_MS)
    return () => clearInterval(timer)
  })

  // On the booth's clock rather than the browser's, so the carousel turns over
  // with the sky (see `background/dayCycle`) and not with wherever the machine
  // thinks it is. `today` is a plain number, so the reorder below only reruns
  // on the day it actually changes.
  const today = $derived(
    boothDay(nowMs, locationFromConfig($daemonConfig).timeZone),
  )
  const daily = $derived(dailyOrder(GAMES, today))

  // Filters narrow the carousel. An empty count set means no constraint, so
  // the launcher opens showing everything.
  const allCounts = playerCountsAcross(GAMES)
  const selectedCounts = new SvelteSet<number>()
  let leaderboardOnly = $state(false)
  let aiOnly = $state(false)

  const visibleGames = $derived(
    daily.games.filter((game) => {
      const { playerCounts, supportsLeaderboard, supportsAi } = game.meta
      if (leaderboardOnly && !supportsLeaderboard) return false
      if (aiOnly && !supportsAi) return false
      if (selectedCounts.size === 0) return true
      return playerCounts.some((n) => selectedCounts.has(n))
    }),
  )

  function toggleCount(n: number): void {
    if (!selectedCounts.delete(n)) selectedCounts.add(n)
  }

  function clearFilters(): void {
    selectedCounts.clear()
    leaderboardOnly = false
    aiOnly = false
  }

  let trackEl = $state<HTMLDivElement>()
  // Mouse-only drag-to-scroll: touch already scrolls natively via
  // `overflow-x: auto`, and adding our own handling on top of it would double
  // up with (and likely fight) the browser's native touch/momentum scrolling.
  //
  // Capture only starts once the pointer actually moves past `DRAG_THRESHOLD`.
  // Capturing eagerly on every pointerdown redirects the eventual click to
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
    // Assigned rather than scrolled to instantly, so the track's
    // `scroll-behavior: smooth` eases into each new offset. That keeps the
    // drag fluid, and it keeps the browser from applying the track's
    // mandatory snapping mid-gesture, which notches the cards against the
    // pointer. `endDrag` does the snapping instead, once.
    trackEl.scrollLeft = drag.startScrollLeft - dx
  }

  function endDrag(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return
    const wasDragging = drag.dragging
    drag = null
    if (wasDragging) snapToNearestSlot()
  }

  // The browser applies the track's mandatory snapping to scrolls it drives
  // itself (touch, wheel), but not to the `scrollLeft` a drag assigns, which
  // would otherwise leave a card stopped wherever the pointer let go. Bring
  // the nearest one back to center by hand once the drag ends.
  function snapToNearestSlot(): void {
    if (!trackEl) return
    const viewportCenter =
      trackEl.getBoundingClientRect().left + trackEl.clientWidth / 2
    let nearest: number | null = null
    for (const slot of trackEl.children) {
      const rect = slot.getBoundingClientRect()
      const offset = rect.left + rect.width / 2 - viewportCenter
      if (nearest === null || Math.abs(offset) < Math.abs(nearest))
        nearest = offset
    }
    // `scrollTo` clamps to the scroll range, so the first and last cards
    // settle at their extreme rather than pulling past it.
    if (nearest !== null)
      trackEl.scrollTo({
        left: trackEl.scrollLeft + nearest,
        behavior: 'smooth',
      })
  }
</script>

<div class="launcher">
  <header class="launcher__header">
    <!--
      Inlined rather than an `<img>`, because the mark is drawn in
      `currentColor` and an image is its own document where that resolves to
      black. Inline, it takes the launcher's own text role and follows the
      day and night palettes.
    -->
    <span class="launcher__logo" role="img" aria-label="Arcade">
      {@html arcadeLogoRaw}
    </span>
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
      {#each visibleGames as game (game.meta.id)}
        <div class="launcher__slot">
          <GameCard
            {game}
            {onPlay}
            gameOfTheDay={game === daily.featured}
            topEntry={game.meta.supportsLeaderboard
              ? topEntries[game.meta.id]
              : undefined}
          />
        </div>
      {/each}
    </div>

    {#if visibleGames.length === 0}
      <p class="launcher__empty">
        {$t.arcade.filters.noMatches}
        <button type="button" class="launcher__clear" onclick={clearFilters}
          >{$t.arcade.filters.clear}</button
        >
      </p>
    {/if}
  </div>

  <div class="launcher__bar">
    <LauncherFilters
      counts={allCounts}
      {selectedCounts}
      {leaderboardOnly}
      {aiOnly}
      onToggleCount={toggleCount}
      onToggleLeaderboard={() => (leaderboardOnly = !leaderboardOnly)}
      onToggleAi={() => (aiOnly = !aiOnly)}
    />
  </div>
</div>

<style lang="sass">
  .launcher
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    justify-content: center
    // Cards read against the engine background, only the track (and the cards
    // in it) capture pointer events.
    pointer-events: none
    --launcher-card-w: 22rem
    --launcher-gap: var(--space-32)
    // Cards that can reach dead center, counting from either end of the row.
    // The track's inline padding is derived from it.
    --launcher-slots: 3

  .launcher__header
    position: absolute
    inset-block-start: var(--space-48)
    inset-inline-start: var(--space-48)
    display: flex
    flex-direction: column
    gap: var(--space-4)

  .launcher__logo
    display: block
    color: var(--color-text)
    // Long enough to ride out the palette switch without reading as a blink.
    transition: color 600ms linear

    :global(svg)
      display: block
      height: 4.5rem
      width: auto

  // Pinned to the launcher's bottom-inline-end corner, on the same inset as
  // the logo in the opposite one. Out of the centred column, so the cards sit
  // where they would with no filters at all, and it holds the corner even when
  // a filter empties the carousel.
  .launcher__bar
    position: absolute
    inset-block-end: var(--space-48)
    inset-inline-end: var(--space-48)
    display: flex
    pointer-events: none

  .launcher__viewport
    position: relative
    width: 100%

  .launcher__empty
    margin: 0
    padding-block: var(--space-48)
    text-align: center
    color: var(--color-text-secondary)
    pointer-events: auto

  .launcher__clear
    @include tint.type-class(ui-bold)
    margin-inline-start: var(--space-8)
    border: none
    background: none
    padding: 0
    color: var(--color-text)
    text-decoration: underline
    cursor: pointer

  .launcher__track
    // Grid (one implicit row, one column per card) rather than flex: every
    // card becomes as tall as the tallest one for free, via the row's own
    // height. `align-items: stretch` (the grid default) then hands that
    // height down to each `.launcher__slot`, which `.game-card` fills (see
    // its own `height: 100%`).
    display: grid
    grid-auto-flow: column
    grid-auto-columns: var(--launcher-card-w)
    gap: var(--launcher-gap)
    // Centers the row when it is too short to scroll, i.e. when a filter
    // leaves fewer cards than the padding below reserves room for. `safe`
    // drops back to start alignment once the row does overflow, which would
    // otherwise put the first card out of reach past the scroll origin.
    justify-content: safe center
    overflow-x: auto
    overflow-y: hidden
    scroll-snap-type: x mandatory
    scroll-behavior: smooth
    // Enough leading/trailing space to center a group of `--launcher-slots`
    // cards, rather than the half-a-viewport it would take to center a lone
    // one. Both scroll extremes then land exactly on a snap point, with that
    // group centered and its middle card dead center: the outermost cards
    // stay reachable but sit beside a neighbour instead of alone against an
    // expanse of bare track.
    padding-inline: calc((100% - (var(--launcher-slots) * var(--launcher-card-w) + (var(--launcher-slots) - 1) * var(--launcher-gap))) / 2)
    // Generous enough to clear the card's own box-shadow (0 0.5rem 2.5rem).
    // `overflow-y: hidden` above would otherwise clip it.
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
