<!--
  Pause menu, opened by tapping outside the board while playing. Fades and scales
  in, and offers Resume / Quit to the main screen.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import Score from '@src/core/ui/Score.svelte'
  import { CF_STRINGS as t } from '../strings'
  import type { MatchScore } from '../game'

  interface Props {
    matchScore: MatchScore
    onResume: () => void
    onQuit: () => void
  }
  const { matchScore, onResume, onQuit }: Props = $props()
</script>

<div class="pause" transition:fade={{ duration: 150 }}>
  <div class="pause__card" transition:scale={{ start: 0.92, duration: 200 }}>
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
