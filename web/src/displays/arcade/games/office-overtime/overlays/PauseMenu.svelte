<!--
  Pause menu, opened by tapping the board outside a card. Resume or quit back to
  the main screen.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { OO_STRINGS as t } from '../strings'

  interface Props {
    onResume: () => void
    onQuit: () => void
  }
  const { onResume, onQuit }: Props = $props()
</script>

<div class="oo-pause" transition:fade={{ duration: 150 }}>
  <div class="oo-pause__card" transition:scale={{ start: 0.92, duration: 200 }}>
    <Surface tone="light">
      <div class="oo-pause__body">
        <h2 class="oo-pause__title">{t.paused}</h2>
        <div class="oo-pause__actions">
          <Button variant="primary" onclick={onResume}>{t.resume}</Button>
          <Button variant="secondary" onclick={onQuit}>{t.quit}</Button>
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .oo-pause
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .oo-pause__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    padding-block: var(--space-48)
    padding-inline: var(--space-32)

  .oo-pause__title
    @include tint.type-class(headline)
    color: var(--color-text)
    margin: 0

  .oo-pause__actions
    display: flex
    gap: var(--space-12)
</style>
