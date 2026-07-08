<script lang="ts">
  import { t } from '@src/i18n'
  import type { GameOverReason, StateId } from '@src/game'
  import type { HighScores } from '@src/lib/gameLogClient'
  import type { EngineHost } from '@src/stargazer'
  import { mountGameOverStage } from '@src/game/gameOver/mountGameOverStage'
  import NumberCounter from './NumberCounter.svelte'
  import Button from './Button.svelte'
  import waveUrl from '@src/assets/over-wave.svg?url'
  import printIconRaw from '@src/assets/icons/print-16.svg?raw'
  import checkmarkIconRaw from '@src/assets/icons/checkmark-16.svg?raw'
  import { fade } from 'svelte/transition'
  import { get } from 'svelte/store'
  import {
    renderLabel,
    squarePxFrom,
    type LabelInput,
  } from './print/labelRenderer'
  import { enqueuePrint, printerLive } from './print/printerClient'

  interface Props {
    reason: GameOverReason
    stateId: StateId
    score: number
    isOverallHigh: boolean
    isStateHigh: boolean
    highScores: HighScores
    /** Escape heading (radians). Populated only for `'exitedGermany'`. */
    escapeHeadingRad?: number
    /** Primary engine host; needed to attach the loss-card animation stage. */
    host: EngineHost
    onContinue: () => void
  }

  const {
    reason,
    stateId,
    score,
    isOverallHigh,
    isStateHigh,
    highScores,
    escapeHeadingRad,
    host,
    onContinue,
  }: Props = $props()

  const reasonTitle = $derived($t.game.gameOverTitle)
  const reasonMessage = $derived(
    reason === 'exitedGermany'
      ? $t.game.gameOverExited
      : $t.game.gameOverCollision,
  )
  const stateHigh = $derived(highScores.byState[stateId] ?? 0)
  const overallHigh = $derived(highScores.overall)
  const showPill = $derived(isOverallHigh || isStateHigh)

  function stateHighLabel(pattern: string, id: string): string {
    return pattern.replace('{state}', id.toUpperCase())
  }

  // ---------------------------------------------------------------------
  // Phase machine; sequences the on-screen reveal:
  //   'counting' → NumberCounter is ticking 0 → score. Pill is present in
  //                the DOM already but sits fully clipped (reserves its
  //                layout slot whether or not a high score was set).
  //   'held'     → pill has been unclipped and is fully open; we hold on
  //                that state for `POST_PILL_HOLD_MS` after the clip
  //                transition finishes before firing the shadow burst.
  //                Skipped when no high was set.
  //   'burst'    → pill's white outward shadow blooms and fades out.
  //   'stats'    → the wave + two lower-half scores fade in.
  //   'ready'    → all animations settled; a tap dismisses the overlay.
  //
  // Phase transitions are driven from callbacks / setTimeout; no cyclic
  // tween loops so a re-mount with a new score always starts fresh at
  // 'counting'.
  // ---------------------------------------------------------------------
  const PILL_EXPAND_MS = 400
  const POST_PILL_HOLD_MS = 500
  const BURST_MS = 600
  const STATS_FADE_MS = 400
  // Chained white flashes after the pill burst: score first, then the
  // record slot(s) that were beaten. Stagger is short enough that flashes
  // overlap slightly rather than reading as a strict sequence.
  const FLASH_DURATION_MS = 650
  const FLASH_INITIAL_DELAY_MS = 200
  const FLASH_STAGGER_MS = 100

  type Phase = 'counting' | 'held' | 'burst' | 'stats' | 'ready'
  let phase = $state<Phase>('counting')
  let flashBig = $state(false)
  let flashOverall = $state(false)
  let flashState = $state(false)

  function onCountingDone(): void {
    if (phase !== 'counting') return
    if (showPill) {
      // Kick off the pill's clip-path reveal, then hold on the fully-open
      // state for `POST_PILL_HOLD_MS` before firing the shadow burst so
      // the pill lands, sits, THEN flashes.
      phase = 'held'
      setTimeout(() => {
        if (phase !== 'held') return
        phase = 'burst'
        // Reveal the bottom stats immediately so they fade in alongside
        // the shadow burst; no need to wait for the burst's alpha to
        // reach zero.
        setTimeout(() => {
          if (phase === 'burst') phase = 'stats'
        }, 0)

        // Staggered white-then-black flashes on the score readouts that
        // reflect what was beaten. Order: big score → overall (if broken)
        // → state (if broken). Slots that weren't beaten are skipped so
        // the sequence collapses cleanly for single-record breaks.
        setTimeout(() => {
          flashBig = true
        }, FLASH_INITIAL_DELAY_MS)
        let nextDelay = FLASH_INITIAL_DELAY_MS + FLASH_STAGGER_MS
        let latestStart = FLASH_INITIAL_DELAY_MS
        if (isOverallHigh) {
          const d = nextDelay
          setTimeout(() => {
            flashOverall = true
          }, d)
          latestStart = d
          nextDelay += FLASH_STAGGER_MS
        }
        if (isStateHigh) {
          const d = nextDelay
          setTimeout(() => {
            flashState = true
          }, d)
          latestStart = d
        }
        const flashesEnd = latestStart + FLASH_DURATION_MS

        setTimeout(
          () => {
            if (phase === 'stats' || phase === 'burst') phase = 'ready'
          },
          Math.max(BURST_MS, STATS_FADE_MS, flashesEnd),
        )
      }, PILL_EXPAND_MS + POST_PILL_HOLD_MS)
    } else {
      phase = 'stats'
      setTimeout(() => {
        if (phase === 'stats') phase = 'ready'
      }, STATS_FADE_MS)
    }
  }

  /**
   * Only dismisses on a tap that lands directly on the backdrop; clicks on the
   * cards themselves bubble up but `e.target !== e.currentTarget` for those, so
   * we ignore them. This matches the design intent of "tap outside the cards to
   * close".
   */
  function handleDismiss(e: PointerEvent): void {
    if (phase !== 'ready') return
    if (e.target !== e.currentTarget) return
    onContinue()
  }

  // ---------------------------------------------------------------------
  // Label printing; enqueues to the local printer-daemon. Non-blocking:
  // `Continue` always works regardless of print state. The button flips to
  // its "printed" state instantly on tap (checkmark icon, disabled) rather
  // than tracking the async daemon phases — the visitor gets an immediate
  // "heard you" signal, and the actual job's success/failure is inspectable
  // from the attendant panel's printer log rather than through this UI.
  // ---------------------------------------------------------------------
  let printSent = $state(false)
  // Only allow printing when the daemon reports the printer is currently
  // reachable. If it's not — daemon offline, printer unplugged, tape jam —
  // the button greys out with the printer icon still shown so the operator
  // can see what's meant to happen once things recover.
  const printerAvailable = $derived(
    $printerLive.connection === 'online' &&
      ($printerLive.printer?.reachable ?? false),
  )
  const printDisabled = $derived(printSent || !printerAvailable)

  function handlePrint(): void {
    if (printDisabled) return
    // Flip the UI state first so the checkmark shows on the next paint,
    // regardless of how long the render/enqueue chain takes.
    printSent = true
    void submitPrint()
  }

  async function submitPrint(): Promise<void> {
    try {
      const input: LabelInput = {
        reason,
        stateId,
        score,
        isOverallHigh,
        isStateHigh,
        highScores,
        escapeHeadingRad,
        printedAt: new Date(),
      }
      // Size the square to the loaded tape when known; falls back to a safe
      // default otherwise. The daemon's autofit corrects any mismatch.
      const tapeWidthMm = $printerLive.printer?.tapeWidthMm
      const blob = await renderLabel(input, {
        messages: get(t),
        size: squarePxFrom(tapeWidthMm),
      })
      await enqueuePrint(blob, {
        stateId,
        score,
        highScore: isOverallHigh || isStateHigh,
        source: 'game',
      })
    } catch (err) {
      // Log for the attendant panel / dev console — the button stays
      // "sent" either way (the visitor's card is dismissable on Continue).
      console.error('[print] label print failed:', err)
    }
  }
</script>

<div
  class="game-over"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onpointerdown={handleDismiss}
  transition:fade={{ duration: 320 }}
>
  <div class="game-over__row">
    <section class="game-over__card game-over__loss">
      <h2 class="game-over__loss-title">{reasonTitle}</h2>
      <canvas
        class="game-over__loss-canvas"
        aria-hidden="true"
        use:mountGameOverStage={{ host, reason, escapeHeadingRad }}
      ></canvas>
      <p class="game-over__loss-message">{reasonMessage}</p>
    </section>

    <section class="game-over__card game-over__score">
      <div class="game-over__score-top">
        <!--
          Always rendered; the pill's box (padding + text) reserves its
          layout slot whether or not the player set a high score, so the
          counter never shifts vertically between rounds. `showPill`
          gates the visible-state classes; without a high score both
          `--expanded` and `--bursting` stay off and the pill stays
          fully clipped by the base `clip-path: inset(0 50% 0 50%)`.
        -->
        <span
          class="game-over__pill"
          class:game-over__pill--expanded={showPill &&
            (phase === 'held' ||
              phase === 'burst' ||
              phase === 'stats' ||
              phase === 'ready')}
          class:game-over__pill--bursting={showPill &&
            (phase === 'burst' || phase === 'stats' || phase === 'ready')}
          aria-hidden={!showPill}
        >
          {$t.game.newHighScoreBanner}
        </span>
        <NumberCounter
          value={score}
          durationMs={1000}
          onComplete={onCountingDone}
          class={`game-over__score-big${flashBig ? ' game-over__score-big--flashing' : ''}`}
        />
        <span
          class="game-over__score-label"
          class:game-over__score-label--flashing={flashBig}
        >
          {score === 1 ? $t.game.point : $t.game.points}
        </span>
      </div>

      <div
        class="game-over__score-bottom"
        class:game-over__score-bottom--shown={phase === 'stats' ||
          phase === 'ready'}
      >
        <img class="game-over__wave" src={waveUrl} alt="" aria-hidden="true" />
        <div class="game-over__stats">
          <div
            class="game-over__stat"
            class:game-over__stat--flashing={flashOverall}
          >
            <strong>{overallHigh}</strong>
            <span>{$t.game.highScoreLabel}</span>
          </div>
          <div
            class="game-over__stat"
            class:game-over__stat--flashing={flashState}
          >
            <strong>{stateHigh}</strong>
            <span>{stateHighLabel($t.game.stateHighScoreLabel, stateId)}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div class="game-over__actions">
    <Button
      variant="primary"
      class="game-over__print-btn"
      disabled={printDisabled}
      onclick={handlePrint}
      aria-label={printSent ? $t.print.printed : $t.print.printButton}
    >
      <span class="game-over__print-icon" aria-hidden="true">
        {#if printSent}
          {@html checkmarkIconRaw}
        {:else}
          {@html printIconRaw}
        {/if}
      </span>
    </Button>
    <Button variant="primary" onclick={onContinue}>
      {$t.game.continueButton}
    </Button>
  </div>
</div>

<style lang="sass">
  .game-over
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: tint.$size-24
    background: rgba(1, 6, 18, 0.55)
    // Full-surface tap target so any touch after the reveal dismisses.
    pointer-events: auto
    z-index: 30

  // `align-items: stretch` lets flexbox equalise the two buttons' heights
  // regardless of their intrinsic content — whichever button is taller
  // sets the cross-axis size, and the other grows to match. Removes any
  // "print button is a few px taller because the icon is bigger than a
  // lowercase 'e'" drift.
  .game-over__actions
    display: flex
    justify-content: center
    align-items: stretch
    gap: tint.$size-16

  // Icon-only print button. Just trim the inline padding since there's no
  // text next to the icon; height comes from the flex-stretch above.
  :global(.game-over__print-btn)
    padding-inline-start: tint.$size-16
    padding-inline-end: tint.$size-16

  .game-over__print-icon
    display: inline-flex
    align-items: center
    justify-content: center
    line-height: 1
    // The acorn icons ship with `fill="context-fill"` (a Firefox-only value
    // that reads the parent's `-moz-context-properties`). Override to
    // `currentColor` in every browser so the icon picks up the button's
    // text color — matching the primary button's near-black label.
    :global(svg)
      width: 1.25em
      height: 1.25em
      fill: currentColor
      display: block

  .game-over__row
    // Explicit `--card-h` / `--card-w` so both cards render at pixel-
    // identical dimensions regardless of internal content. Without this,
    // `aspect-ratio` + flex was letting one card compute a slightly
    // different width than the other on some viewport sizes. Sized to
    // 2/3 of the design mock (645 × 490) for a subtler footprint.
    --card-h: min(53.33vh, 550px)
    --card-w: calc(var(--card-h) * 490 / 645)
    display: flex
    gap: tint.$size-16
    height: var(--card-h)
    margin: 0 auto

  .game-over__card
    box-sizing: border-box
    height: var(--card-h)
    width: var(--card-w)
    flex: 0 0 auto
    border-radius: tint.$size-32
    overflow: hidden
    position: relative

  // -----------------------------------------------------------------
  // Loss card (dark); title on top, canvas placeholder in the middle,
  // subtitle at the bottom. Canvas has no engine attached yet; kept
  // as a plain element so a future scene mount inherits the layout.
  // -----------------------------------------------------------------
  .game-over__loss
    background: #010612
    display: flex
    flex-direction: column
    color: #ffffff
    padding: tint.$size-48 tint.$size-32
    align-items: center
    gap: tint.$size-16
    // Canvas is absolutely positioned to span the whole card behind the
    // text; the title + message stay in normal flow but get `position:
    // relative` so they paint on top of the canvas.
    justify-content: space-between

  .game-over__loss-title
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
    font-size: 1.667rem
    line-height: 1.05
    margin: 0
    text-align: center
    // `z-index: 1` bumps the title above the sibling canvas; both are
    // positioned with `z-index: auto`, and the canvas comes AFTER the
    // title in DOM order, so without an explicit z the canvas paints
    // on top and hides the headline.
    position: relative
    z-index: 1

  .game-over__loss-canvas
    // Fills the whole card behind the text. `inset: 0` (in a
    // `position: absolute` block) also naturally sets width/height to
    // 100% of the parent's content-box + padding, so the canvas covers
    // edge-to-edge.
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    pointer-events: none

  .game-over__loss-message
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
    font-size: 1rem
    text-align: center
    margin: 0
    color: rgba(255, 255, 255, 0.9)
    max-width: 22ch
    // Same reason as the title; sits above the canvas.
    position: relative
    z-index: 1

  // -----------------------------------------------------------------
  // Score card (yellow → orange → pink gradient). Two vertical halves:
  //   top: pill (optional) + big score + Punkte label
  //   bottom: wave background + two smaller high-score cells
  // -----------------------------------------------------------------
  .game-over__score
    background: linear-gradient(75deg, #FFEB49 -30.28%, #F60 119.37%, #FB2872 232.27%)
    color: #010612
    display: flex
    flex-direction: column
    // No padding on the card; the top / bottom halves manage their own
    // insets so the wave SVG in the lower half can span the card's
    // full width edge-to-edge without gaps.

  .game-over__score-top
    flex: 1
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: tint.$size-8
    position: relative
    padding: tint.$size-80 tint.$size-32
    padding-block-start: tint.$size-64

  .game-over__pill
    padding: tint.$size-8 tint.$size-16
    background: #ffffff
    color: #010612
    border-radius: 9999px
    font-family: tint.$mozilla-text
    font-weight: 700
    letter-spacing: 0.06em
    text-transform: uppercase
    font-size: 0.883rem
    white-space: nowrap
    margin-block-end: tint.$size-24
    // Reveal-from-centre: the pill's box (including its padding) is
    // present at final size the whole time, but the visible area is
    // clipped by `clip-path: inset(0 50% 0 50%)`; a zero-width
    // vertical strip down the middle. When `--expanded` flips on we
    // animate the right + left insets to `0`, so the visible pill
    // wipes open symmetrically. Unlike `max-width: 0 → auto`, this
    // truly reaches ZERO visible size at rest (padding included) and
    // preserves the pill's final geometry throughout.
    clip-path: inset(0 50% 0 50%)
    transition: clip-path 400ms cubic-bezier(0.22, 1, 0.36, 1)
    position: relative
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0)

  .game-over__pill--expanded
    clip-path: inset(0 0 0 0)

  .game-over__pill--bursting
    // The base pill uses `clip-path` to animate the wipe reveal, but any
    // clip-path; including `inset(0 0 0 0)` at the fully-open state ;
    // creates a clipping context that TRUNCATES the outset `box-shadow`
    // used by the burst. Once we're in the burst phase the reveal is
    // long complete, so drop the clip-path entirely and let the shadow
    // radiate outward.
    clip-path: none
    animation: pill-burst 600ms ease-out forwards

  @keyframes pill-burst
    from
      box-shadow: 0 0 0 0 rgba(255, 255, 255, 1)
    to
      box-shadow: 0 0 0 32px rgba(255, 255, 255, 0)

  :global(.game-over__score-big)
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
    font-size: 8.333rem
    line-height: 1
    font-variant-numeric: tabular-nums

  // White-then-black flash on the record readouts. Runs once; the class
  // is added and stays, but the keyframe returns to the base colour on
  // its own so the final rest state matches the initial one. `forwards`
  // guarantees we hold on that rest colour even if the browser rounds
  // the last frame.
  :global(.game-over__score-big--flashing)
    animation: score-flash 650ms ease-in-out forwards

  // Ramp up quickly, hold on white for a beat so the eye catches it,
  // then ease back. The plateau between 25% and 55% is the "hold".
  @keyframes score-flash
    0%
      color: #010612
    25%
      color: #ffffff
    55%
      color: #ffffff
    100%
      color: #010612

  .game-over__score-label
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
    font-size: 1.333rem
    line-height: 1

  .game-over__score-bottom
    flex: 0 0 45%
    position: relative
    opacity: 0
    transition: opacity 400ms ease-out

  .game-over__score-bottom--shown
    opacity: 1

  .game-over__wave
    position: absolute
    left: 0
    right: 0
    top: -96px
    width: 100%
    height: auto
    pointer-events: none
    user-select: none
    -webkit-user-drag: none

  .game-over__stats
    position: relative
    display: flex
    gap: tint.$size-48
    padding: tint.$size-24 tint.$size-32
    justify-content: center
    align-items: flex-start

  .game-over__stat
    display: flex
    flex-direction: column
    align-items: center
    gap: tint.$size-4
    text-align: center

    strong
      font-family: tint.$mozilla-headline-extended
      font-weight: 700
      font-size: 2.917rem
      line-height: 1
      font-variant-numeric: tabular-nums

  // Applied to the stat wrapper so both the number and its label share
  // the flash. Children have no explicit `color` so they inherit the
  // animated value from this element.
  .game-over__stat--flashing
    animation: score-flash 650ms ease-in-out forwards

  .game-over__score-label--flashing
    animation: score-flash 650ms ease-in-out forwards
</style>
