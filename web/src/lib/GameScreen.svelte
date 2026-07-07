<script lang="ts">
  import StateConfirmCard from './StateConfirmCard.svelte'
  import GameOverOverlay from './GameOverOverlay.svelte'
  import AttendantControls from './AttendantControls.svelte'
  import PauseOverlay from './PauseOverlay.svelte'
  import DebugHud from '@src/stargazer/debug/DebugHud.svelte'
  import { t } from '@src/i18n'
  import { goToScreen } from '@src/stores/appState'
  import { mountEngine, ignoreAbort, type EngineHost } from '@src/stargazer'
  import { startGame, type GameSession, type StateId } from '@src/game'
  import { debugHudVisible, setDebugHudVisible } from './boothMenuToggle'
  import type { GameEvents } from '@src/game'

  type GameOverPayload = GameEvents['gameOver']

  let host = $state<EngineHost | null>(null)
  let session = $state<GameSession | null>(null)
  let selectedStateId = $state<StateId | null>(null)
  let activeStateId = $state<StateId | null>(null)
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
   * gameOver / preGame state; this simply freezes the whole engine ticker via
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

  async function onEngineReady(h: EngineHost): Promise<void> {
    try {
      host = h
      const s = await startGame(h)
      session = s
      s.events.on('stateSelected', (payload) => {
        selectedStateId = payload.stateId
      })
      s.events.on('selectionCanceled', () => {
        selectedStateId = null
      })
      s.events.on('roundStarted', (payload) => {
        selectedStateId = null
        activeStateId = payload.stateId
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
        activeStateId = null
        score = 0
        goToScreen('idle')
      })
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  function onEngineDestroy(): void {
    session?.destroy()
    session = null
    host = null
  }

  function confirmSelection(): void {
    session?.startRound().catch(ignoreAbort)
  }

  function reset(): void {
    // Kick the overlay's fade-out immediately; otherwise the DOM sticks
    // around until `session.reset()`'s camera zoom completes (~600 ms)
    // and only THEN begins to fade, which reads as a stuck card. The
    // `'reset'` event listener still fires later and re-clears this
    // (harmlessly, since it's already null) alongside `activeStateId`
    // and the screen change, which are timed to the zoom's completion.
    gameOverPayload = null
    session?.reset().catch(ignoreAbort)
  }

  // Two backdrop slots sit behind the (transparent) canvas at the bottom
  // corners. Contents switch on whether a round is live:
  //
  //   pre-play  → left: "choose a state" prompt, right: mission text
  //   playing / game over → left: state name, right: score (zero-padded
  //                          to 2 digits so single-digit scores read
  //                          "01", "02", … which matches the mock)
  //
  // `activeStateId` is the pivot; it's non-null only during / after a
  // round, which is exactly when we want the state-name + score pair.
  const isRoundActive = $derived(activeStateId !== null)
  const backdropLeftText = $derived(
    isRoundActive && activeStateId !== null
      ? $t.states[activeStateId]
      : session !== null && !loadError && selectedStateId === null
        ? // Hide the "pick a state" prompt once a state is selected ;
          // the confirm card takes over the choice at that point and the
          // corner prompt would just repeat what the card already says.
          $t.game.idleHint
        : null,
  )
  const backdropRightText = $derived(
    isRoundActive || selectedStateId !== null
      ? null
      : session !== null
        ? $t.game.confirmStateHint
        : null,
  )
  // Two-digit minimum with leading zero; reads as a scoreboard. Scores
  // past 99 (unlikely but possible) render bare (100, 101, …) and just
  // extend leftward from the anchored right edge. `tabular-nums` on the
  // CSS side keeps every digit the same width so the readout doesn't
  // jitter as it counts.
  const scoreDisplay = $derived(String(score).padStart(2, '0'))

  // Mirror the booth-menu-driven `debugHudVisible` store into the engine's
  // debug controller. Runs when either the store or the host changes; the
  // controller's `setHudVisible` is idempotent so re-entry after a
  // no-op flip costs nothing.
  $effect(() => {
    if (!host) return
    host.debug.setHudVisible($debugHudVisible)
  })

  // Keep the outbound store in sync if the debug HUD is toggled via
  // keyboard shortcut inside the controller (Y key). Two-way binding ;
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
    Backdrop text sits BEFORE the canvas in DOM order so the transparent
    canvas draws on top; the text reads through as a muted background
    layer while the map + packets composite over it. No z-index needed:
    document order controls the stacking within `.game`.
  -->
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
      options: {
        transparent: true,
        initialViewport: { x: 0, y: 0, width: 661, height: 888 },
        // Drop render resolution during camera zooms + under sustained
        // overload (defaults from DEFAULT_DYNAMIC_RESOLUTION); the 4K kiosk
        // can't push native res through the per-frame blit at 60fps.
        dynamicResolution: { enabled: true },
      },
      onReady: onEngineReady,
      onDestroy: onEngineDestroy,
    }}
  ></canvas>

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

  {#if selectedStateId && host}
    <StateConfirmCard
      stateId={selectedStateId}
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
      showPause={activeStateId !== null && gameOverPayload === null}
      onTogglePause={togglePause}
    />
  {/if}
</main>

{#if host}
  <DebugHud debug={host.debug} />
{/if}

<style lang="sass">
  .game
    position: relative
    height: 100%
    width: 100%
    overflow: hidden

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
    // Dynamic resolution downscales the backing store during zooms; the CSS
    // compositor upscales it to the 4K element. Bilinear (`auto`) is the right
    // filter for our anti-aliased vector shapes; pin it so a UA/theme default
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
    color: var(--tint-text-secondary)
    @include tint.type-class(ui)

  // Bottom-corner backdrop copy; sits behind the transparent canvas so
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

  // Idle-state distances from the edges; noticeably larger than the
  // playing-state figures below so the headline + mission text sit
  // clearly inset from the corners. `.game__backdrop--active` overrides
  // these back to the tighter playing values.
  .game__backdrop-headline
    position: absolute
    left: tint.$size-80
    bottom: tint.$size-80
    max-width: 35%
    color: #fff
    font-size: 4.5rem
    letter-spacing: -0.01em

  .game__backdrop-mission
    position: absolute
    right: tint.$size-80
    bottom: tint.$size-80
    max-width: 25%
    color: #fff
    font-size: 1.5rem
    font-weight: 500
    line-height: 1.25
    text-align: right

  .game__backdrop-score
    position: absolute
    right: tint.$size-48
    bottom: tint.$size-48
    // Huge outlined-looking numeral. `font-variant-numeric: slashed-zero`
    // matches the mock's slash through the leading zero; `tabular-nums`
    // keeps every digit the same width so the score doesn't jitter as
    // it counts up (10 vs 11 render the same shape width). Text is
    // right-anchored so 3-digit scores extend leftward from a fixed
    // right edge without shifting the final digit.
    font-size: 16rem
    letter-spacing: -0.04em
    font-variant-numeric: slashed-zero tabular-nums
    line-height: 0.9

  // When a round is live, both slots dim to a low-opacity backdrop so
  // they don't compete with the gameplay foreground. Position also
  // tightens back toward the corner; the idle padding is decorative,
  // gameplay wants the score bigger against the frame edge. The
  // typography switches to Mozilla Slab Headline Expanded per the mock;
  // the woff2 isn't shipped yet, so the cascade falls through to Mozilla
  // Headline Extended (bold slab-ish) until it lands in
  // `src/assets/fonts/`.
  .game__backdrop--active
    .game__backdrop-headline
      left: tint.$size-48
      bottom: tint.$size-48

    .game__backdrop-headline,
    .game__backdrop-score
      color: rgba(9, 22, 44, 0.55)
      font-family: 'Mozilla Slab Headline Expanded', 'Mozilla Headline Extended', tint.$mozilla-headline
</style>
