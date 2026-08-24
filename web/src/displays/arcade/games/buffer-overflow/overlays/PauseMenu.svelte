<!--
  Pause menu, the one modal during play. Built from the shared `Surface` and
  `Button`, with all colour from the theme.

  Framed and square rather than a rounded card, and titled in the same inverse
  bar the canvas panes use, so the one thing that covers the game still reads as
  part of it. Continue returns to the buffer, kill ends the run and returns to
  the menu.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { BUFFER_OVERFLOW_STRINGS as t } from '../strings'

  interface Props {
    onResume: () => void
    onQuit: () => void
  }
  const { onResume, onQuit }: Props = $props()
</script>

<div class="pause" transition:fade={{ duration: 150 }}>
  <div class="pause__card" transition:scale={{ start: 0.92, duration: 180 }}>
    <Surface tone="light">
      <div class="pause__body">
        <h2 class="pause__title">{t.paused}</h2>
        <div class="pause__actions">
          <Button variant="primary" onclick={onResume}>[ {t.resume} ]</Button>
          <Button variant="secondary" onclick={onQuit}>[ {t.quit} ]</Button>
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

  .pause__card
    // Square and ruled, like every other frame the game draws.
    :global(> *)
      border-radius: 0

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
    text-transform: lowercase
    letter-spacing: 0.04em

  .pause__actions
    display: flex
    gap: var(--space-16)
</style>
