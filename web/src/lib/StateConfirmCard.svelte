<script lang="ts">
  import Button from './Button.svelte'
  import { t } from '@src/i18n'
  import {
    fetchHighScores,
    type HighScores,
  } from '@src/lib/gameLogClient'
  import type { StateId } from '@src/game/data/states'
  import { mountTutorialStage } from '@src/game/tutorial/mountTutorialStage'
  import type { EngineHost } from '@src/stargazer'
  import waveUrl from '@src/assets/confirm-wave-card.svg?url'
  import { STATE_PHOTOS } from '@src/game/data/statePhotos'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'

  interface Props {
    stateId: StateId
    host: EngineHost
    onConfirm: () => void
  }

  const { stateId, host, onConfirm }: Props = $props()

  // Refetched every time this card mounts (or `stateId` changes) so the
  // numbers reflect any recent attendant-side deletes / wipes without the
  // player having to reload. Same-origin fetch; typically <10 ms.
  let highScores = $state<HighScores>({ overall: 0, byState: {} })
  $effect(() => {
    void stateId
    let alive = true
    fetchHighScores()
      .then((s) => {
        if (alive) highScores = s
      })
      .catch((e: unknown) => {
        console.warn('[confirm-card] high-score fetch failed', e)
      })
    return () => {
      alive = false
    }
  })

  const stateName = $derived($t.states[stateId])
  const stateHigh = $derived(highScores.byState[stateId] ?? 0)
  const overallHigh = $derived(highScores.overall)
  const photo = $derived(STATE_PHOTOS[stateId])

  /** Substitute `{state}` in the labelled string with the state's ISO id. */
  function stateHighLabel(pattern: string, id: string): string {
    return pattern.replace('{state}', id.toUpperCase())
  }

  // Stop pointer events from falling through to the map canvas underneath.
  function stopPointer(event: Event): void {
    event.stopPropagation()
  }
</script>

<div
  class="confirm-card__mount"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onpointerdown={stopPointer}
  transition:fly={{ y: 480, duration: 450, opacity: 1, easing: cubicOut }}
>
  <div class="confirm-card__row">
    <section class="confirm-card confirm-card--tutorial" aria-hidden="true">
      <canvas
        class="confirm-card__tutorial-canvas"
        use:mountTutorialStage={{ host }}
      ></canvas>
    </section>
    <section class="confirm-card confirm-card--main">
      {#key stateId}
        <img
          class="confirm-card__state-photo"
          src={photo.url}
          alt=""
          aria-hidden="true"
        />
      {/key}
      <img class="confirm-card__wave" src={waveUrl} alt="" aria-hidden="true" />
      <div class="confirm-card__body">
        <h2 class="confirm-card__state">{stateName}</h2>
        <p class="confirm-card__scores">
          <span class="confirm-card__score-cell">
            <strong>{overallHigh}</strong>
            <span>{$t.game.highScoreLabel}</span>
          </span>
          <span class="confirm-card__score-cell">
            <strong>{stateHigh}</strong>
            <span>{stateHighLabel($t.game.stateHighScoreLabel, stateId)}</span>
          </span>
        </p>
      </div>
      <div class="confirm-card__actions">
        <Button variant="primary" onclick={onConfirm}>
          {$t.game.startButton}
        </Button>
      </div>
    </section>
  </div>
</div>

<style lang="sass">
  .confirm-card__mount
    position: absolute
    left: 0
    right: 0
    bottom: 0
    display: flex
    flex-direction: column
    align-items: center
    gap: tint.$size-16
    padding: tint.$size-24
    padding-block-start: 0
    max-width: min(1060px, 88vw)
    margin: 0 auto
    // The cards own pointer events so touches inside don't leak to the map.
    pointer-events: auto
    z-index: 20

  .confirm-card__row
    display: flex
    align-items: stretch
    gap: tint.$size-8
    width: 100%

  .confirm-card
    display: flex
    align-items: center
    padding: tint.$size-32
    padding-block-start: tint.$size-48
    background: linear-gradient(299deg, #F6CCE1 28.39%, rgba(241, 201, 231, 0.62) 44.13%, rgba(237, 199, 237, 0.28) 58.81%, rgba(234, 198, 240, 0.08) 69.07%, rgba(234, 198, 242, 0.00) 74.11%), linear-gradient(0deg, #EAC6F2 0%, #EAC6F2 100%)
    box-shadow: 0 20px 60px rgba(9, 22, 44, 0.35)
    color: #1b1035

  .confirm-card--tutorial
    flex: 0 0 auto
    width: 300px
    // Tutorial canvas fills the card edge-to-edge; the padding + inner
    // dark box the placeholder used have been removed.
    padding: 0
    overflow: hidden
    background: #0d0d10
    border-radius: tint.$size-48 tint.$size-16 tint.$size-16 tint.$size-48
    min-height: 200px

  .confirm-card--main
    flex: 1 1 auto
    gap: tint.$size-24
    border-radius: tint.$size-16 tint.$size-48 tint.$size-48 tint.$size-16
    // Wave sits inside as an absolutely-positioned decor `<img>`; clip so
    // its right edge disappears behind the rounded corner.
    position: relative
    overflow: hidden
    // Override the base card's centered `align-items` so the body can
    // stretch to full height; required for state-top / scores-bottom
    // vertical distribution below.
    align-items: stretch

  .confirm-card__wave
    position: absolute
    left: 0
    top: 0
    height: 100%
    width: auto
    pointer-events: none
    user-select: none
    -webkit-user-drag: none

  .confirm-card__state-photo
    // Fills the main card behind everything else, `cover`-sized so the
    // landscape crops cleanly at any card size. Opacity fades 0 → 0.5
    // over 2 s via the `state-photo-fade-in` animation below;
    // `{#key stateId}` in the template forces a remount on state change
    // so the animation replays for the next photo.
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    object-fit: cover
    opacity: 0
    animation: state-photo-fade-in 2s ease-out forwards
    pointer-events: none
    user-select: none
    -webkit-user-drag: none

  @keyframes state-photo-fade-in
    from
      opacity: 0
    to
      opacity: 0.5

  .confirm-card__tutorial-canvas
    display: block
    width: 100%
    height: 100%
    // Kiosk hygiene; Stage sets this too, defensive against a canvas that
    // paints before the stargazer's touch-action rules apply.
    touch-action: none
    user-select: none

  .confirm-card__body
    display: flex
    flex-direction: column
    gap: tint.$size-8
    min-width: 0
    flex: 1 1 auto
    // Stacking so the body paints ABOVE the absolutely-positioned wave.
    position: relative
    // State name pins to the top of the body, scores pin to the bottom.
    justify-content: space-between
    // Reserve the top-right corner for the absolutely-positioned start
    // button so long state names ("Nordrhein-Westfalen") don't collide
    // with it. `9rem` covers the widest `type-class(action)` button
    // label plus its 16 px edge margin.
    padding-right: 9rem

  .confirm-card__state
    @include tint.type-class(title-1)
    margin: 0
    line-height: 1.05
    // Match the score numbers; the whole "who/what" heading reads in
    // the extended headline face for a coherent block.
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
    max-width: 60%

  .confirm-card__scores
    display: flex
    gap: tint.$size-24
    margin: 0
    flex-wrap: wrap

  .confirm-card__score-cell
    display: inline-flex
    align-items: baseline
    gap: tint.$size-8

    strong
      @include tint.type-class(title-3)
      font-family: tint.$mozilla-headline-extended
      font-weight: 700

    span
      @include tint.type-class(ui-small)
      opacity: 0.7
      text-transform: uppercase
      letter-spacing: 0.04em

  .confirm-card__actions
    // Pinned to the top-right corner of the main card, 16 px inset from
    // both edges. Paints above the wave (later in DOM order among
    // positioned elements) and above the body (which is `position:
    // relative` but earlier in DOM); no explicit z-index needed.
    position: absolute
    top: tint.$size-16
    right: tint.$size-16
    display: flex
    gap: tint.$size-16
</style>
