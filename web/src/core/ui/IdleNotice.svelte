<!--
  The last seconds before an idle booth puts itself back the way it opened. A
  pill slides down from the top edge with a ring draining beside it. Any touch
  restarts the idle clock, which takes the notice away, so the pill takes no
  taps itself.

  The look follows the theme. A display restyles it through custom properties
  passed on the component, such as `--idle-notice-top` or `--idle-notice-bg`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'
  import { expoOut } from 'svelte/easing'

  interface Props {
    /** True for the span the countdown covers. */
    visible: boolean
    /** What happens when the countdown runs out. */
    message: string
    /** How long the countdown runs, so the ring drains in step with it. */
    durationMs: number
    /** Drawn before the message. */
    icon?: Snippet
  }
  const { visible, message, durationMs, icon }: Props = $props()

  /** Ring geometry, in the SVG's own viewBox units. */
  const RADIUS = 9
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
</script>

{#if visible}
  <div
    class="idle"
    role="status"
    style="--idle-warn-duration: {durationMs}ms; --idle-ring-length: {CIRCUMFERENCE}"
    transition:fly={{ y: -160, duration: 320, easing: expoOut }}
  >
    {#if icon}
      <span class="idle__icon" aria-hidden="true">{@render icon()}</span>
    {/if}
    <span>{message}</span>
    <!-- Created the moment the countdown starts, so the drain needs no clock of
         its own to stay in step with the reset. -->
    <svg class="idle__ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="idle__ring-track" cx="12" cy="12" r={RADIUS} />
      <circle class="idle__ring-drain" cx="12" cy="12" r={RADIUS} />
    </svg>
  </div>
{/if}

<style lang="sass">
  .idle
    position: absolute
    inset-block-start: var(--idle-notice-top, var(--space-24))
    inset-inline-start: 50%
    transform: translateX(-50%)
    z-index: var(--z-overlay)
    display: inline-flex
    align-items: center
    gap: var(--space-12)
    pointer-events: none
    border-radius: var(--radius-pill)
    padding-block: var(--idle-notice-padding-block, var(--space-12))
    padding-inline: var(--space-24)
    font-family: var(--idle-notice-font, var(--font-heading))
    font-weight: 700
    font-size: var(--idle-notice-font-size, 1.1rem)
    color: var(--idle-notice-color, var(--color-text))
    background: var(--idle-notice-bg, var(--color-surface-card))
    box-shadow: var(--color-shadow-card)
    white-space: nowrap

  .idle__icon
    display: inline-flex
    align-items: center

  .idle__ring
    display: block
    flex: 0 0 auto
    width: 1.5rem
    height: 1.5rem
    // Start the sweep at twelve o'clock rather than three.
    transform: rotate(-90deg)

  .idle__ring-track,
  .idle__ring-drain
    fill: none
    stroke-width: 3

  .idle__ring-track
    stroke: var(--idle-notice-track, var(--color-border))

  .idle__ring-drain
    stroke: currentColor
    stroke-linecap: round
    stroke-dasharray: var(--idle-ring-length)
    animation: idle-drain var(--idle-warn-duration) linear forwards

  @keyframes idle-drain
    from
      stroke-dashoffset: 0
    to
      stroke-dashoffset: var(--idle-ring-length)

  @media (forced-colors: active)
    .idle
      forced-color-adjust: none
      border: 2px solid ButtonText
</style>
