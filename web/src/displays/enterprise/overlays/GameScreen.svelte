<script lang="ts">
  import StateConfirmCard from './StateConfirmCard.svelte'
  import SmallRegionList from './SmallRegionList.svelte'
  import GameOverOverlay from './GameOverOverlay.svelte'
  import AttendantControls from '@src/core/attendant/AttendantControls.svelte'
  import PauseOverlay from './PauseOverlay.svelte'
  import DebugHud from '@src/stargazer/debug/DebugHud.svelte'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import { t, regionName, mapCopy } from '@src/displays/enterprise/i18n'
  import { goToScreen } from '@src/stores/appState'
  import { selectedStateId, stopGameHandle } from '@src/stores/gameSelection'
  import { mountEngine, ignoreAbort, type EngineHost } from '@src/stargazer'
  import {
    startGame,
    loadMap,
    resolveMapId,
    DEFAULT_MAP_ID,
    type GameSession,
    type MapDescriptor,
    type RegionId,
  } from '@src/displays/enterprise/game'
  import { activeMap } from '@src/displays/enterprise/activeMap'
  import {
    debugHudVisible,
    setDebugHudVisible,
  } from '@src/core/attendant/boothMenuToggle'
  import { coverScreen } from '@src/displays/enterprise/attendant/coverState'
  import CoverScreen from '@src/displays/enterprise/attendant/CoverScreen.svelte'
  import Backdrop from '@src/displays/enterprise/background/Backdrop.svelte'
  import type { GameEvents } from '@src/displays/enterprise/game'

  type GameOverPayload = GameEvents['gameOver']
  type Gfx = 'webgpu' | 'webgl2' | 'auto'

  // Backend selection + WebGPU-loss recovery. The `?gfx` URL param seeds the
  // choice. A lost WebGPU device can't reuse its canvas, so recovery bumps
  // `canvasKey` (re-keying the `<canvas>` so `mountEngine` rebuilds on a fresh
  // node) and forces WebGL2 for the remount.
  function urlBackend(): Gfx {
    const g = new URLSearchParams(location.search).get('gfx')
    return g === 'webgpu' || g === 'webgl2' ? g : 'auto'
  }
  let forcedBackend = $state<'webgl2' | null>(null)
  let canvasKey = $state(0)
  const backend = $derived<Gfx>(forcedBackend ?? urlBackend())

  function onBackendLost(): void {
    console.warn('[enterprise] WebGPU device lost, remounting on WebGL2')
    forcedBackend = 'webgl2'
    canvasKey++
  }

  let host = $state<EngineHost | null>(null)
  let offFontChange: (() => void) | null = null
  let session = $state<GameSession | null>(null)
  let activeRegionId = $state<RegionId | null>(null)
  /** The loaded map, needed to resolve region names in this screen's copy. */
  let map = $state<MapDescriptor | null>(null)
  /**
   * Regions the corner list offers. Read once the session is ready rather than
   * derived, since it depends on the canvas size at that moment.
   */
  let smallRegionIds = $state<readonly string[]>([])
  let gameOverPayload = $state<GameOverPayload | null>(null)
  let loadError = $state<string | null>(null)
  /**
   * Live score for the corner backdrop. `session.score` is authoritative but a
   * plain getter, so we mirror it here and update on the round's events. Resets
   * to `0` on each `roundStarted` and stays visible after `gameOver` so the
   * final score reads through the game-over grace.
   */
  let score = $state(0)
  /**
   * Attendant-driven engine pause. Distinct from the session-level playing /
   * gameOver / preGame state, this simply freezes the whole engine ticker via
   * `EngineHost.pause()`. The pause overlay covers the canvas so the visible
   * frame stays still.
   */
  let paused = $state(false)

  function togglePause(): void {
    if (!host) return
    if (paused) {
      host.resume()
      paused = false
    } else {
      host.pause()
      paused = true
    }
  }

  // The cover screen freezes the engine while visible so idle CPU/GPU drops
  // and in-progress rounds don't tick down while nobody's looking. Idempotent
  // with the manual pause button. Either signal being "on" keeps the engine
  // paused, both being "off" resumes it.
  $effect(() => {
    if (!host) return
    if (paused || $coverScreen.visible) host.pause()
    else host.resume()
  })

  async function onEngineReady(h: EngineHost): Promise<void> {
    try {
      host = h
      offFontChange = invalidateTextOnFontLoad(h.engine)
      // `?map=` picks the map, defaulting in code so a kiosk URL that
      // predates it still boots. An unknown value throws into the catch below
      // and shows as a load error, rather than quietly running another map.
      const mapId = resolveMapId(
        new URLSearchParams(window.location.search).get('map'),
      )
      const loaded = await loadMap(mapId)
      map = loaded
      activeMap.set({ id: loaded.id, i18nNamespace: loaded.i18nNamespace })
      const s = await startGame(h, loaded)
      session = s
      smallRegionIds = s.smallRegionIds
      s.events.on('stateSelected', (payload) => {
        selectedStateId.set(payload.stateId)
      })
      s.events.on('selectionCanceled', () => {
        selectedStateId.set(null)
      })
      s.events.on('roundStarted', (payload) => {
        selectedStateId.set(null)
        activeRegionId = payload.stateId
        score = 0
        goToScreen('playing')
      })
      s.events.on('packetScored', (payload) => {
        score = payload.total
      })
      s.events.on('gameOver', (payload) => {
        gameOverPayload = payload
        goToScreen('result')
      })
      s.events.on('reset', () => {
        gameOverPayload = null
        activeRegionId = null
        score = 0
        goToScreen('idle')
      })
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  function onEngineDestroy(): void {
    offFontChange?.()
    offFontChange = null
    session?.destroy()
    session = null
    host = null
    map = null
    smallRegionIds = []
    activeMap.set(null)
  }

  function confirmSelection(): void {
    session?.startRound().catch(ignoreAbort)
  }

  function reset(): void {
    // Kick the overlay's fade-out immediately, otherwise the DOM sticks
    // around until `session.reset()`'s camera zoom completes (~600 ms)
    // and only THEN begins to fade, which reads as a stuck card. The
    // `'reset'` event listener still fires later and re-clears this
    // (harmlessly, since it's already null) alongside `activeRegionId`
    // and the screen change, which are timed to the zoom's completion.
    gameOverPayload = null
    session?.reset().catch(ignoreAbort)
  }

  // Publish the abort handle for the attendant-menu "Stop game" button.
  // `session.reset()` is a no-op when already idle, so the handle stays
  // safe to invoke unconditionally. Unregisters on unmount so a stale
  // reference to a torn-down session can't be called.
  $effect(() => {
    if (!session) return
    stopGameHandle.set(reset)
    return () => stopGameHandle.set(null)
  })

  // Two backdrop slots sit behind the (transparent) canvas at the bottom
  // corners. Contents switch on whether a round is live:
  //
  //   pre-play  → left: "choose a state" prompt, right: mission text
  //   playing / game over → left: state name, right: score (zero-padded
  //                          to 2 digits so single-digit scores read
  //                          "01", "02", … which matches the mock)
  //
  // `activeRegionId` is the pivot, it's non-null only during / after a
  // round, which is exactly when we want the state-name + score pair.
  const isRoundActive = $derived(activeRegionId !== null)
  const backdropLeftText = $derived(
    isRoundActive && activeRegionId !== null
      ? regionName($t, map?.i18nNamespace ?? 'states', activeRegionId)
      : session !== null && !loadError && $selectedStateId === null
        ? // Hide the "pick a state" prompt once a state is selected, the
          // confirm card takes over the choice at that point and the
          // corner prompt would just repeat what the card already says.
          mapCopy($t, map?.id ?? DEFAULT_MAP_ID).pick
        : null,
  )
  const backdropRightText = $derived(
    isRoundActive || $selectedStateId !== null
      ? null
      : session !== null
        ? mapCopy($t, map?.id ?? DEFAULT_MAP_ID).mission
        : null,
  )
  // Two-digit minimum with leading zero, reads as a scoreboard. Scores
  // past 99 (unlikely but possible) render bare (100, 101, …) and just
  // extend leftward from the anchored right edge. `tabular-nums` on the
  // CSS side keeps every digit the same width so the readout doesn't
  // jitter as it counts.
  const scoreDisplay = $derived(String(score).padStart(2, '0'))

  // Mirror the booth-menu-driven `debugHudVisible` store into the engine's
  // debug controller. Runs when either the store or the host changes. The
  // controller's `setHudVisible` is idempotent so re-entry after a
  // no-op flip costs nothing.
  $effect(() => {
    if (!host) return
    host.debug.setHudVisible($debugHudVisible)
  })

  // Keep the outbound store in sync if the debug HUD is toggled via
  // keyboard shortcut inside the controller (Y key). Two-way binding,
  // without this, pressing Y wouldn't update the booth-menu label.
  $effect(() => {
    if (!host) return
    const off = host.debug.events.on('toggle', ({ hud }) => {
      if (hud !== $debugHudVisible) setDebugHudVisible(hud)
    })
    return off
  })
</script>

<main class="game">
  <!--
    The brand backdrop canvas, the backdrop text, and the transparent game
    canvas draw in that order, furthest back first. No z-index needed:
    document order controls the stacking within `.game`. The text reads
    through the transparent game canvas as a muted layer while the map +
    packets composite over it, and both canvases sit together in one
    `{#key}` block so a WebGPU device-loss remount rebuilds them as a pair.
  -->
  {#key canvasKey}
    {#if host}
      <Backdrop engine={host.engine} />
    {/if}

    <div class="game__backdrop" class:game__backdrop--active={isRoundActive}>
      {#if backdropLeftText}
        <span class="game__backdrop-headline">{backdropLeftText}</span>
      {/if}
      {#if isRoundActive}
        <span class="game__backdrop-score">{scoreDisplay}</span>
      {:else if backdropRightText}
        <span class="game__backdrop-mission">{backdropRightText}</span>
      {/if}
    </div>

    <canvas
      class="game__canvas"
      use:mountEngine={{
        backend,
        onBackendLost,
        options: {
          transparent: true,
        },
        onReady: onEngineReady,
        onDestroy: onEngineDestroy,
      }}
    ></canvas>
  {/key}

  {#if !session && !loadError}
    <div class="game__center">
      <p class="game__hint">{$t.game.loading}</p>
    </div>
  {/if}

  {#if loadError}
    <div class="game__center">
      <p class="game__hint">{loadError}</p>
    </div>
  {/if}

  {#if session && !isRoundActive && !$selectedStateId && !gameOverPayload}
    <SmallRegionList
      regionIds={smallRegionIds}
      mapId={map?.id ?? DEFAULT_MAP_ID}
      onPick={(id) => session?.selectRegion(id)}
    />
  {/if}

  {#if $selectedStateId && host}
    <StateConfirmCard
      stateId={$selectedStateId}
      mapId={map?.id ?? DEFAULT_MAP_ID}
      {host}
      onConfirm={confirmSelection}
    />
  {/if}

  {#if gameOverPayload && host}
    <GameOverOverlay
      reason={gameOverPayload.reason}
      stateId={gameOverPayload.stateId}
      score={gameOverPayload.score}
      isOverallHigh={gameOverPayload.isOverallHigh}
      isStateHigh={gameOverPayload.isStateHigh}
      highScores={gameOverPayload.highScores}
      escapeHeadingRad={gameOverPayload.escapeHeadingRad}
      {host}
      onContinue={reset}
    />
  {/if}

  {#if paused}
    <PauseOverlay onResume={togglePause} />
  {/if}

  {#if host}
    <AttendantControls
      {paused}
      showPause={activeRegionId !== null && gameOverPayload === null}
      onTogglePause={togglePause}
    />
  {/if}
</main>

{#if host}
  <DebugHud debug={host.debug} />
{/if}

{#if $coverScreen.visible}
  <CoverScreen />
{/if}

<style lang="sass">
  .game
    position: relative
    height: 100%
    width: 100%
    overflow: hidden
    // Bottom-right stack: the mission copy sits at the bottom, the region
    // list above it. They cannot share a flex parent, because the copy renders
    // behind the transparent canvas while the list has to take taps in front
    // of it, so the two anchor to the same inset instead.
    --corner-inset: var(--space-80)
    // Height reserved for the mission copy: three lines at its own size.
    --corner-copy-height: 6rem

  .game__canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    touch-action: none
    user-select: none
    -webkit-user-select: none
    outline: none
    // Dynamic resolution downscales the backing store during zooms. The CSS
    // compositor upscales it to the 4K element. Bilinear (`auto`) is the right
    // filter for our anti-aliased vector shapes, pin it so a UA/theme default
    // can't swap in `pixelated`/`crisp-edges` and introduce jaggies.
    image-rendering: auto

  .game__center
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    pointer-events: none

  .game__hint
    color: var(--color-text-secondary)
    @include tint.type-class(ui)

  // Bottom-corner backdrop copy, sits behind the transparent canvas so
  // the map + packets composite over it. `pointer-events: none` so it
  // never intercepts a state tap that lands in the same pixel area.

  .game__backdrop
    position: absolute
    inset: 0
    pointer-events: none
    user-select: none
    font-family: tint.$mozilla-headline
    font-weight: 700
    line-height: 0.95

  // Idle-state distances from the edges, noticeably larger than the
  // playing-state figures below so the headline + mission text sit
  // clearly inset from the corners. `.game__backdrop--active` overrides
  // these back to the tighter playing values.
  .game__backdrop-headline
    position: absolute
    inset-inline-start: var(--space-80)
    inset-block-end: var(--space-80)
    max-width: 35%
    color: var(--color-text-inverse)
    // Art-directed backdrop copy sizes (not part of the semantic UI scale).
    font-size: 4.5rem
    letter-spacing: -0.01em

  .game__backdrop-mission
    position: absolute
    inset-inline-end: var(--corner-inset)
    inset-block-end: var(--corner-inset)
    max-width: 25%
    color: var(--color-text-inverse)
    font-size: 1.5rem
    font-weight: 500
    line-height: 1.25
    text-align: right

  .game__backdrop-score
    position: absolute
    inset-inline-end: var(--space-48)
    inset-block-end: var(--space-48)
    // Huge outlined-looking numeral. `font-variant-numeric: slashed-zero`
    // matches the mock's slash through the leading zero. `tabular-nums`
    // keeps every digit the same width so the score doesn't jitter as
    // it counts up (10 vs 11 render the same shape width). Text is
    // right-anchored so 3-digit scores extend leftward from a fixed
    // right edge without shifting the final digit.
    @include tint.type-class(watermark)
    letter-spacing: -0.04em
    font-variant-numeric: slashed-zero tabular-nums
    line-height: 0.9

  // When a round is live, both slots dim to a low-opacity backdrop so
  // they don't compete with the gameplay foreground. Position also
  // tightens back toward the corner, the idle padding is decorative,
  // gameplay wants the score bigger against the frame edge. The
  // typography switches to the widest brand face, standing in for the
  // Mozilla Slab Headline Expanded the mock calls for until that woff2
  // ships in `src/assets/fonts/`.
  .game__backdrop--active
    .game__backdrop-headline
      inset-inline-start: var(--space-48)
      inset-block-end: var(--space-48)

    .game__backdrop-headline,
    .game__backdrop-score
      color: rgba(9, 22, 44, 0.55)
      font-family: tint.$font-mozilla-headline-extended
</style>
