<script lang="ts">
  import { fade } from 'svelte/transition'
  import { t } from '@src/displays/stallwaechter/i18n'
  import Button from '@src/core/ui/Button.svelte'

  interface Props {
    onResume: () => void
  }

  const { onResume }: Props = $props()

  /**
   * Dismiss only on backdrop taps; clicks on the card itself bubble up but
   * `e.target !== e.currentTarget` for those, so we ignore them. Same pattern
   * as `GameOverOverlay.handleDismiss`.
   */
  function handleDismiss(e: PointerEvent): void {
    if (e.target !== e.currentTarget) return
    onResume()
  }
</script>

<div
  class="pause-overlay"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onpointerdown={handleDismiss}
  in:fade={{ duration: 220 }}
  out:fade={{ duration: 160 }}
>
  <section class="pause-overlay__card">
    <h2 class="pause-overlay__title">{$t.game.pauseTitle}</h2>
    <p class="pause-overlay__hint">{$t.game.pauseHint}</p>
    <div class="pause-overlay__actions">
      <Button variant="primary" onclick={onResume}>
        {$t.game.resumeButton}
      </Button>
    </div>
  </section>
</div>

<style lang="sass">
  .pause-overlay
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    // Full-surface tap target; anywhere outside the card dismisses.
    pointer-events: auto
    z-index: var(--z-overlay)

  .pause-overlay__card
    // Shared dark-card visual; see `src/styles/tokens.sass`. Matches
    // the game-over "data lost" card so the two overlays feel like the
    // same family of dialogs.
    @include tint.dark-card
    box-sizing: border-box
    // Sized proportionally to the game-over score card, scaled to a smaller
    // footprint since the pause card carries only a title + button.
    width: min(28vw, 21.25rem)
    padding-block: var(--space-48)
    padding-inline: var(--space-32)
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    text-align: center
    box-shadow: var(--color-shadow-panel)

  .pause-overlay__title
    @include tint.type-class(headline-sm)
    line-height: 1.05
    margin: 0

  .pause-overlay__hint
    @include tint.type-class(ui)
    line-height: 1.4
    margin: 0
    color: var(--color-text-inverse)
    opacity: 0.7
    max-width: 22ch

  .pause-overlay__actions
    display: flex
    justify-content: center
    margin-block-start: var(--space-8)
</style>
