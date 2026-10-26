<script lang="ts">
  /**
   * The paused screen. A page overlay with CSS transitions rather than an
   * engine node, since the engine itself is what is paused and its tweens stand
   * still until it resumes. Sized in design pixels scaled to the window, like
   * the rest of the screens.
   */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '@src/displays/enterprise/i18n'

  interface Props {
    onResume: () => void
  }

  const { onResume }: Props = $props()

  /** Resume on a tap anywhere outside the card. The card's button resumes too. */
  function handleDismiss(e: PointerEvent): void {
    if (e.target !== e.currentTarget) return
    onResume()
  }
</script>

<div
  class="pause"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onpointerdown={handleDismiss}
  in:fade={{ duration: 200 }}
  out:fade={{ duration: 160 }}
>
  <section
    class="pause__card"
    in:scale={{ start: 0.9, duration: 260, easing: cubicOut }}
  >
    <h2 class="pause__title">{$t.game.pauseTitle}</h2>
    <p class="pause__hint">{$t.game.pauseHint}</p>
    <button class="pause__resume" onclick={onResume}>
      {$t.game.resumeButton}
    </button>
  </section>
</div>

<style lang="sass">
  // One design pixel, the 1920 by 1080 frame fitted into the window.
  .pause
    --px: min(100vw / 1920, 100vh / 1080)
    position: absolute
    inset: 0
    z-index: var(--z-overlay)
    display: flex
    align-items: center
    justify-content: center
    background: rgba(21, 20, 26, 0.35)
    backdrop-filter: blur(6px)

  .pause__card
    display: flex
    flex-direction: column
    align-items: center
    gap: calc(var(--px) * 32)
    padding: calc(var(--px) * 64) calc(var(--px) * 96)
    border-radius: calc(var(--px) * 48)
    background: linear-gradient(224.2deg, #fcf5f0 43.78%, #f9f9f9 91.31%), #ffffff
    color: #15141a
    text-align: center

  .pause__title
    margin: 0
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: calc(var(--px) * 120)
    line-height: 0.85
    letter-spacing: calc(var(--px) * -2.4)
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

  .pause__hint
    margin: 0
    font-family: var(--font-mozilla-text)
    font-weight: 500
    font-size: calc(var(--px) * 32)
    opacity: 0.6

  .pause__resume
    appearance: none
    border: 0
    cursor: pointer
    height: calc(var(--px) * 80)
    padding: 0 calc(var(--px) * 40)
    border-radius: 999px
    background: #15141a
    color: #ffffff
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: calc(var(--px) * 40)
    letter-spacing: calc(var(--px) * -0.8)
    white-space: nowrap
</style>
