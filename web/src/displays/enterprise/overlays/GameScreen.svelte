<script lang="ts">
  import PauseOverlay from './PauseOverlay.svelte'
  import DebugHud from '@src/stargazer/debug/DebugHud.svelte'
  import { invalidateTextOnFontLoad } from '@src/core/fonts'
  import { onDestroy } from 'svelte'
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
  import UiStage from '@src/displays/enterprise/ui/UiStage.svelte'
  import SplashScreen from '@src/displays/enterprise/ui/SplashScreen.svelte'
  import SelectPrompt from '@src/displays/enterprise/ui/SelectPrompt.svelte'
  import SelectedScreen from '@src/displays/enterprise/ui/SelectedScreen.svelte'
  import PlayingHud from '@src/displays/enterprise/ui/PlayingHud.svelte'
  import FailEdges from '@src/displays/enterprise/ui/FailEdges.svelte'
  import GameOverScreen from '@src/displays/enterprise/ui/GameOverScreen.svelte'
  import IdleNotice from '@src/displays/enterprise/ui/IdleNotice.svelte'
  import {
    ScreenFlow,
    type ScreenState,
  } from '@src/displays/enterprise/game/flow/screenFlow'
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
  /** Which of the five screens is showing. Mirrors `flow`. */
  let screen = $state<ScreenState>('splash')
  const flow = new ScreenFlow()
  /** The idle return is close, so the notice shows. */
  let idleWarning = $state(false)
  const offWarning = flow.onWarning((warning) => {
    idleWarning = warning
  })
  const offFlow = flow.onChange((next, prev) => {
    screen = next
    // Back to the splash from the picker or the zoomed card, on a timeout or
    // a tap on the picker's headline. The map has to come back out before the
    // splash plays over it.
    if (next === 'splash' && (prev === 'select' || prev === 'selected')) {
      session?.cancelSelection().catch(ignoreAbort)
    }
    // The result timed out. Close already reset the round on its own way out,
    // which leaves the session idle by the time the flow moves, so this only
    // runs for the timeout.
    if (
      next === 'splash' &&
      prev === 'gameOver' &&
      session?.state === 'gameOver'
    ) {
      reset()
    }
  })
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
      s.events.on('stateSelected', (payload) => {
        selectedStateId.set(payload.stateId)
        flow.send('pick')
      })
      s.events.on('selectionCanceled', () => {
        selectedStateId.set(null)
        flow.send('back')
      })
      s.events.on('roundStarted', (payload) => {
        selectedStateId.set(null)
        activeRegionId = payload.stateId
        score = 0
        flow.send('start')
        goToScreen('playing')
      })
      s.events.on('packetScored', (payload) => {
        score = payload.total
      })
      s.events.on('gameOver', (payload) => {
        gameOverPayload = payload
        flow.send('ended')
        goToScreen('result')
      })
      s.events.on('reset', () => {
        gameOverPayload = null
        activeRegionId = null
        score = 0
        flow.send(flow.state === 'gameOver' ? 'continue' : 'abort')
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
    activeMap.set(null)
  }

  function play(): void {
    flow.send('play')
  }

  function backToSplash(): void {
    flow.send('back')
  }

  // The map fades under the result so its cards read clearly.
  $effect(() => {
    session?.setMapDimmed(screen === 'gameOver')
  })

  // The splash plays a round by itself over the map, and nothing else does.
  $effect(() => {
    if (!session) return
    if (screen === 'splash') session.startAttract()
    else session.stopAttract()
  })

  // Taps on the map select a region only while the player is picking.
  $effect(() => {
    session?.setTapsEnabled(screen === 'select' || screen === 'selected')
  })

  onDestroy(() => {
    offWarning()
    offFlow()
    flow.destroy()
  })

  function confirmSelection(): void {
    session?.startRound().catch(ignoreAbort)
  }

  /** Back to the selected card for the region just played. */
  function playAgain(): void {
    if (!flow.send('again')) return
    gameOverPayload = null
    session?.returnToSelection()
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

  /** The round's region name for the header, held after a round for its exit. */
  let hudRegionName = $state('')
  $effect(() => {
    if (activeRegionId !== null) {
      hudRegionName = regionName(
        $t,
        map?.i18nNamespace ?? 'states',
        activeRegionId,
      )
    }
  })
  const copy = $derived(mapCopy($t, map?.id ?? DEFAULT_MAP_ID))
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

<main
  class="game"
  onpointerdowncapture={() => flow.touch()}
  onkeydowncapture={() => flow.touch()}
>
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
      <Backdrop
        engine={host.engine}
        variant={screen === 'select' || screen === 'selected'
          ? 'radial'
          : 'diagonal'}
      />
    {/if}

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

    {#if host}
      <UiStage engine={host.engine}>
        {#snippet children(region)}
          <SplashScreen
            engine={host!.engine}
            {region}
            active={screen === 'splash' && session !== null}
            headline={$t.game.splashHeadline}
            description={copy.splashDescription}
            playLabel={$t.game.playButton}
            mapId={map?.id ?? DEFAULT_MAP_ID}
            onPlay={play}
          />
          <SelectPrompt
            engine={host!.engine}
            {region}
            active={screen === 'select' && session !== null}
            prompt={copy.selectPrompt}
            onBack={backToSplash}
          />
          <SelectedScreen
            engine={host!.engine}
            {region}
            active={screen === 'selected' && session !== null}
            regionId={$selectedStateId}
            mapId={map?.id ?? DEFAULT_MAP_ID}
            namespace={map?.i18nNamespace ?? 'states'}
            onStart={confirmSelection}
          />
          <PlayingHud
            engine={host!.engine}
            {region}
            active={screen === 'playing'}
            {score}
            elapsed={() => session?.elapsedSec ?? 0}
            regionName={hudRegionName}
            onPause={togglePause}
          />
          {#if map?.edgesAreFailLine}
            <FailEdges
              engine={host!.engine}
              {region}
              active={screen === 'playing'}
            />
          {/if}
          <GameOverScreen
            engine={host!.engine}
            host={host!}
            {region}
            active={screen === 'gameOver'}
            payload={gameOverPayload}
            mapId={map?.id ?? DEFAULT_MAP_ID}
            onPlayAgain={playAgain}
            onClose={reset}
          />
        {/snippet}
      </UiStage>
    {/if}
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

  <IdleNotice visible={idleWarning} />

  {#if paused}
    <PauseOverlay onResume={togglePause} />
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
</style>
