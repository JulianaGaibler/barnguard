<script lang="ts">
  import { locale, setLocale, t } from '@src/i18n'

  interface Props {
    paused: boolean
    /**
     * Whether the pause button is available. `false` outside an active round ;
     * nothing meaningful to freeze on the idle map or the game- over screen.
     * The language toggle stays visible either way.
     */
    showPause: boolean
    onTogglePause: () => void
  }

  const { paused, showPause, onTogglePause }: Props = $props()

  // The toggle flips between the two supported locales. Booth default is
  // German (`de`); English is the one attendants might swap in for a
  // visiting non-German speaker.
  function toggleLocale(): void {
    setLocale($locale === 'de' ? 'en' : 'de')
  }
</script>

<div class="attendant-controls">
  <!--
    Pause button sits to the LEFT of the language toggle so that when
    it disappears (outside an active round) the language toggle keeps
    its position anchored to the bottom-right corner.
  -->
  {#if showPause}
    <button
      type="button"
      class="attendant-controls__btn attendant-controls__btn--icon"
      onclick={onTogglePause}
      aria-label={paused
        ? $t.attendant.resumeAriaLabel
        : $t.attendant.pauseAriaLabel}
      aria-pressed={paused}
    >
      {#if paused}
        <!-- Play icon; filled triangle pointing right. -->
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M6 4.5 L15.5 10 L6 15.5 Z" fill="currentColor" />
        </svg>
      {:else}
        <!-- Pause icon; two vertical bars. -->
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect
            x="5"
            y="4.5"
            width="3"
            height="11"
            rx="0.5"
            fill="currentColor"
          />
          <rect
            x="12"
            y="4.5"
            width="3"
            height="11"
            rx="0.5"
            fill="currentColor"
          />
        </svg>
      {/if}
    </button>
  {/if}
  <button
    type="button"
    class="attendant-controls__btn"
    onclick={toggleLocale}
    aria-label={$t.attendant.languageToggleAriaLabel}
  >
    <!-- Show the OTHER language code so the button reads as "tap to switch to X". -->
    {$locale === 'de' ? 'EN' : 'DE'}
  </button>
</div>

<style lang="sass">
  .attendant-controls
    // Bottom-right of the viewport, deliberately faint. These are
    // attendant-facing controls; visitors shouldn't notice them.
    position: fixed
    right: tint.$size-16
    bottom: tint.$size-16
    display: flex
    gap: tint.$size-8
    z-index: 40
    pointer-events: auto

  .attendant-controls__btn
    // Small, transparent, low-contrast. Hover / focus lifts the opacity
    // so an attendant confirming aim gets tactile-ish feedback.
    box-sizing: border-box
    width: 28px
    height: 28px
    padding: 0
    display: inline-flex
    align-items: center
    justify-content: center
    background: transparent
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: tint.$size-8
    color: rgba(255, 255, 255, 0.35)
    font-family: tint.$mozilla-text
    font-size: 0.6875rem
    font-weight: 600
    letter-spacing: 0.06em
    text-transform: uppercase
    cursor: pointer
    transition: color 150ms ease, border-color 150ms ease, background 150ms ease

    &:hover, &:focus-visible
      color: rgba(255, 255, 255, 0.8)
      border-color: rgba(255, 255, 255, 0.5)
      background: rgba(255, 255, 255, 0.05)
      outline: none

    &[aria-pressed='true']
      color: rgba(255, 255, 255, 0.85)
      border-color: rgba(255, 255, 255, 0.6)

  .attendant-controls__btn--icon svg
    width: 14px
    height: 14px
    display: block
</style>
