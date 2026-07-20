<!--
  Pause menu. As the player swipes out from the field center it fades/scales in
  proportionally (drag feedback via `progress`); it stays non-interactive until
  the swipe commits (`progress === 1`, engine frozen) so the ongoing swipe keeps
  reaching the canvas. Offers Resume / Quit to the main screen.
-->
<script lang="ts">
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import Score from '@src/core/ui/Score.svelte'
  import { ORBO_STRINGS as t } from '../strings'
  import type { MatchScore } from '../game'

  interface Props {
    matchScore: MatchScore
    /** 0..1 reveal; 1 = committed/interactive. */
    progress: number
    onResume: () => void
    onQuit: () => void
  }
  const { matchScore, progress, onResume, onQuit }: Props = $props()

  const committed = $derived(progress >= 1)
  const cardScale = $derived(0.92 + 0.08 * progress)
</script>

<div class="pause" class:pause--live={committed} style="opacity: {progress}">
  <div class="pause__card" style="transform: scale({cardScale})">
    <Surface tone="light">
      <div class="pause__body">
        <h2 class="pause__title">{t.paused}</h2>
        <Score left={matchScore.teamL} right={matchScore.teamR} />
        <div class="pause__actions">
          <Button variant="primary" onclick={onResume}>{t.resume}</Button>
          <Button variant="secondary" onclick={onQuit}>{t.quit}</Button>
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .pause
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    // Preview (mid-swipe) is non-interactive so the swipe keeps reaching the
    // canvas; only the committed menu captures input to freeze the game.
    pointer-events: none
    transition: opacity 0.1s linear

  .pause--live
    pointer-events: auto

  .pause__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    padding-block: var(--space-48)
    padding-inline: var(--space-64)
    text-align: center

  .pause__title
    margin: 0
    @include tint.type-class(headline)

  .pause__actions
    display: flex
    gap: var(--space-16)
</style>
