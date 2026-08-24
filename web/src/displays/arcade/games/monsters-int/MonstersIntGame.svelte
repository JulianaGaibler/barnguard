<!--
  Monsters, Int's root component: builds the 3D table, wires the overlays, and
  tears the whole subtree down on unmount.

  The split follows the rest of the arcade. Everything under `game/` is pure or
  engine-only and knows nothing about Svelte; this file owns the mode choice and
  the DOM overlays.

  One deliberate departure from the checklist in `docs/adding-a-game.md`: there
  is no `GradientBackgroundNode`. The 3D pass draws before every 2D layer, so a
  2D backdrop would hide the table completely. This game's backdrop is the table
  itself, which is 3D and wide enough to fill the frame, and the shared arcade
  sky is leased away through `backdrop` for as long as a match runs.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { domAnchor, type Rect } from '@src/stargazer'
  import { coverView, REGION_HEIGHT, REGION_WIDTH } from '../../world'
  import { PauseButtonNode } from '../common/PauseButtonNode'
  import type { GameProps } from '../GameModule'
  import Button from '@src/core/ui/Button.svelte'
  import PauseMenu from '@src/displays/arcade/menu/PauseMenu.svelte'
  import HowToPlay from '../../tutorial/HowToPlay.svelte'
  import SplashScreen from './overlays/SplashScreen.svelte'
  import TargetPrompt from './overlays/TargetPrompt.svelte'
  import RoundSummaryCard from './overlays/RoundSummary.svelte'
  import {
    buildScene,
    COLORS,
    seatName,
    startSession,
    type GameOver,
    type RoundSummary,
    type SceneHandle,
    type SeatCount,
    type Session,
    type TargetPrompt as TargetPromptView,
  } from './game'
  import { buildMonstersIntMenuPreview } from './game/menuPreview'
  import { scorePlayer } from './game/rules/player'
  import { recordArcadeGame } from '../../game-log'
  import { MONSTERS_INT_STRINGS as t } from './strings'
  import { MONSTERS_INT_TUTORIAL } from './tutorial'

  const { host, onExit, camera, backdrop, demoStage, region }: GameProps =
    $props()

  let screen = $state<'splash' | 'game'>('splash')
  let paused = $state(false)
  let showTutorial = $state(false)
  // Overlays pin to the shell's own anchor, so the whole DOM surface rides the
  // camera through the launcher-to-game pan.
  const anchor = $derived(region.anchor)
  const gameRect = $derived(region.rect)
  const cornerInset = $derived(region.cornerInset)

  let scene: SceneHandle | null = null
  let pauseButton: PauseButtonNode | null = null
  let session: Session | null = null
  let target = $state<TargetPromptView | null>(null)
  /** Match clock, started with the deal and read once at game over. */
  let matchStartMs = 0
  let summary = $state<RoundSummary | null>(null)
  let over = $state<GameOver | null>(null)

  /**
   * The pause control sits in the top left, inset past the booth's corner
   * gesture. That gesture listens at capture phase and swallows the tap, so a
   * control resting inside the box would silently never fire.
   */
  function placePauseButton(view: Rect): void {
    if (!pauseButton) return
    const size = Math.min(view.width, view.height) * 0.05
    const inset = Math.max(size * 0.5, cornerInset)
    pauseButton.setSize(size)
    pauseButton.transform.x = view.x + inset
    pauseButton.transform.y = view.y + inset
  }

  /**
   * Record the finished match.
   *
   * One record per seat, each carrying that seat's own total, which is what
   * makes a five-handed result comparable with a duel. Monsters, Int keeps no
   * leaderboard, so nothing waits on a name and the write goes out here.
   */
  function logMatch(result: GameOver, seats: SeatCount): void {
    const durationMs = Math.round(performance.now() - matchStartMs)
    const winner = result.winners.map((s) => seatName(s)).join(' and ')
    const warn = (e: unknown): void =>
      console.warn('[monsters-int] failed to record game to server', e)
    for (const row of result.standings) {
      void recordArcadeGame({
        gameId: 'monsters-int',
        mode: `${seats}p`,
        winner,
        score: row.total,
        durationMs,
      }).catch(warn)
    }
  }

  function start(seats: SeatCount): void {
    if (!scene) return
    // The shared sky draws in the `static` 2D layer, which paints over the
    // whole 3D pass. Taking it down here rather than on mount means the change
    // happens behind the menu instead of blinking during the launcher pan.
    backdrop.setVisible(false)
    screen = 'game'
    matchStartMs = performance.now()
    scene.setSeats(seats)
    if (pauseButton) pauseButton.visible = true

    const table = scene
    session?.destroy()
    session = startSession({
      host,
      seats,
      scene: {
        beginRound: (round) => table.cards?.beginRound(round),
        apply: (event, round) => table.cards?.apply(event, round),
        clearRound: () => table.cards?.clearRound(),
        setActiveSeat: (seat, round) => table.cards?.setActiveSeat(seat, round),
        setControlsEnabled: (enabled, canStay) =>
          table.setControlsEnabled(enabled, canStay),
        sync: (round, m, status) => {
          table.hud.setSeats(
            round.players.map((p) => ({
              seat: p.seat,
              label: seatName(p.seat),
              total: m.totals[p.seat] ?? 0,
              round: p.status === 'busted' ? null : scorePlayer(p).total,
              status: p.status,
              up:
                round.pending.kind === 'turn' && round.pending.seat === p.seat,
            })),
          )
          table.hud.setStatus(status)
          table.hud.setMatch(m.round + 1, m.totals)
        },
      },
    })
    session.events.on('awaitingTarget', (t) => (target = t))
    session.events.on('roundOver', (s) => (summary = s))
    session.events.on('gameOver', (g) => {
      over = g
      logMatch(g, seats)
    })
  }

  function toSplash(): void {
    backdrop.setVisible(true)
    host.engine.setPaused(false)
    paused = false
    screen = 'splash'
    session?.destroy()
    session = null
    target = null
    summary = null
    over = null
    scene?.hideHud()
    scene?.cards?.clearRound()
    scene?.setControlsEnabled(false)
    if (pauseButton) pauseButton.visible = false
  }

  function nextRound(): void {
    summary = null
    session?.nextRound()
  }

  function pause(): void {
    if (screen !== 'game') return
    host.engine.setPaused(true)
    paused = true
  }

  function resume(): void {
    host.engine.setPaused(false)
    paused = false
  }

  /**
   * Finish the match where it stands rather than walking away from it.
   *
   * The engine comes off pause first, since the result card is the game still
   * running and the standings animate in.
   */
  function endEarly(): void {
    host.engine.setPaused(false)
    paused = false
    session?.endNow()
  }

  /**
   * Cover rect for the menu backdrop: the whole visible area at the fixed
   * region aspect, so the monster and the cream behind it reach every edge
   * whatever shape the window is.
   */
  const previewView = (): Rect =>
    coverView(gameRect, REGION_WIDTH / REGION_HEIGHT)

  // The monster being fed, up only while the menu is. Reading `gameRect` is
  // what rebuilds it on a resize.
  $effect(() => {
    if (screen !== 'splash') return
    const preview = buildMonstersIntMenuPreview(host, previewView(), gameRect)
    return () => preview.destroy()
  })

  onMount(() => {
    const view = region.rect

    const button = new PauseButtonNode({
      onClick: pause,
      fill: COLORS.cream,
      ink: COLORS.ink,
    })
    button.visible = false
    host.engine.tree.root.add(button)
    pauseButton = button
    placePauseButton(view)

    const built = buildScene({
      host,
      camera,
      view,
      onHit: () => session?.hit(),
      onStay: () => session?.stay(),
    })
    scene = built
    built.setControlsEnabled(false)

    const offResize = region.onResize((v) => {
      scene?.resize(v)
      placePauseButton(v)
    })

    return () => {
      offResize()
      host.engine.setPaused(false)
      session?.destroy()
      session = null
      scene?.destroy()
      scene = null
      if (!button.isDestroyed) button.destroy()
      pauseButton = null
    }
  })
</script>

<div class="mi">
  {#if anchor}
    <div
      class="mi__ui"
      use:domAnchor={{
        engine: host.engine,
        node: anchor,
        size: { width: gameRect.width, height: gameRect.height },
        cull: true,
      }}
    >
      {#if screen === 'splash'}
        <SplashScreen
          onStart={start}
          {onExit}
          onHowToPlay={demoStage ? () => (showTutorial = true) : undefined}
        />
      {/if}

      {#if target}
        <TargetPrompt
          prompt={target}
          onPick={(seat) => {
            target = null
            session?.pickTarget(seat)
          }}
        />
      {/if}

      {#if summary && !over}
        <RoundSummaryCard {summary} onNext={nextRound} />
      {/if}

      {#if over}
        <RoundSummaryCard result={over} onMenu={toSplash} />
      {/if}

      {#if paused}
        <PauseMenu onResume={resume} onQuit={toSplash}>
          {#snippet extra()}
            <Button variant="ghost" onclick={endEarly}>{t.endEarly}</Button>
          {/snippet}
        </PauseMenu>
      {/if}
    </div>
  {/if}

  <!-- Screen-space, outside the camera-anchored wrapper, so its own canvas
       renders at true resolution rather than scaled with the region. -->
  {#if showTutorial && demoStage}
    <HowToPlay
      cards={MONSTERS_INT_TUTORIAL}
      {demoStage}
      onClose={() => (showTutorial = false)}
    />
  {/if}
</div>

<style lang="sass">
  .mi
    position: absolute
    inset: 0
    pointer-events: none
    font-family: var(--font-text)

  .mi__ui
    pointer-events: none

</style>
