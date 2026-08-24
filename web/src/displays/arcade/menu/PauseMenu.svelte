<!--
  The one modal during play, shared by every game: a scrim, a card, and Resume
  or Quit. A game with a running match puts its score in the `detail` snippet,
  and a game that reveals the menu from a drag drives `progress` instead of
  taking the default entrance.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { t } from '../i18n'

  interface Props {
    onResume: () => void
    onQuit: () => void
    /** Overrides, for a game whose wording genuinely differs. */
    title?: string
    resumeLabel?: string
    quitLabel?: string
    /** Between the title and the buttons, e.g. a match score. */
    detail?: Snippet
    /**
     * Below Resume and Quit, for a way out of the game that is not either of
     * them. Its own row, since a third button alongside two makes the pair read
     * as three equal choices.
     */
    extra?: Snippet
    /**
     * Reveal, 0 to 1, for a menu the player drags open. The card tracks the
     * drag and stays non-interactive short of 1, so the gesture keeps reaching
     * the canvas underneath. Omit for the fade and scale entrance.
     */
    progress?: number
  }
  const {
    onResume,
    onQuit,
    title,
    resumeLabel,
    quitLabel,
    detail,
    extra,
    progress,
  }: Props = $props()

  const dragged = $derived(progress !== undefined)
  const previewing = $derived(progress !== undefined && progress < 1)
</script>

{#snippet card()}
  <Surface tone="light">
    <div class="pause__body">
      <h2 class="pause__title">{title ?? $t.arcade.pause.title}</h2>
      {@render detail?.()}
      <div class="pause__actions">
        <Button variant="primary" onclick={onResume}>
          {resumeLabel ?? $t.arcade.pause.resume}
        </Button>
        <Button variant="secondary" onclick={onQuit}>
          {quitLabel ?? $t.arcade.pause.quit}
        </Button>
      </div>
      {@render extra?.()}
    </div>
  </Surface>
{/snippet}

{#if dragged}
  <div
    class="pause pause--dragged"
    class:pause--previewing={previewing}
    style="opacity: {progress}"
  >
    <div
      class="pause__card"
      style="transform: scale({0.92 + 0.08 * progress!})"
    >
      {@render card()}
    </div>
  </div>
{:else}
  <div class="pause" transition:fade={{ duration: 150 }}>
    <div class="pause__card" transition:scale={{ start: 0.92, duration: 180 }}>
      {@render card()}
    </div>
  </div>
{/if}

<style lang="sass">
  .pause
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .pause--dragged
    transition: opacity 0.1s linear

  // Mid-drag the menu is feedback, not a target: the gesture that is opening it
  // has to keep reaching the canvas.
  .pause--previewing
    pointer-events: none

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
