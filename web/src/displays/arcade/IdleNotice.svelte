<!--
  The last thirty seconds before an idle booth returns itself to the launcher.
  A pill slides down from the top edge with a ring draining beside it. Any
  touch anywhere restarts the idle clock, which takes the notice away with it,
  so the pill itself stays click-through and offers nothing to press.
-->
<script lang="ts">
  import { fly } from 'svelte/transition'
  import { expoOut } from 'svelte/easing'
  import { t } from './i18n'
  import RobotIcon from './RobotIcon.svelte'
  import { IDLE_WARN_MS } from './idle'

  interface Props {
    /** True for the span the countdown covers. */
    visible: boolean
  }
  const { visible }: Props = $props()

  /** Ring geometry, in the SVG's own viewBox units. */
  const RADIUS = 9
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
</script>

{#if visible}
  <div
    class="idle"
    role="status"
    style="--idle-warn-duration: {IDLE_WARN_MS}ms; --idle-ring-length: {CIRCUMFERENCE}"
    transition:fly={{ y: -160, duration: 320, easing: expoOut }}
  >
    <span class="idle__icon" aria-hidden="true">
      <RobotIcon size={20} />
    </span>
    <span>{$t.arcade.idle.returningToLauncher}</span>
    <!-- The ring is created the moment the countdown starts, so its animation
         needs no clock of its own to stay in step with the reset. -->
    <svg class="idle__ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="idle__ring-track" cx="12" cy="12" r={RADIUS} />
      <circle class="idle__ring-drain" cx="12" cy="12" r={RADIUS} />
    </svg>
  </div>
{/if}

<style lang="sass">
  // Same dock as the swipe-down return pill. The two cannot collide: that pill
  // hides itself seconds after the gesture that reveals it, and this one needs
  // minutes of stillness to appear.
  .idle
    position: absolute
    inset-block-start: var(--space-24)
    inset-inline-start: 50%
    transform: translateX(-50%)
    z-index: var(--z-overlay)
    display: inline-flex
    align-items: center
    gap: var(--space-12)
    pointer-events: none
    border-radius: var(--radius-pill)
    padding-block: var(--space-12)
    padding-inline: var(--space-24)
    @include tint.type-class(pill)
    color: var(--color-text)
    background: var(--color-surface-card)
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
    stroke: var(--color-border)

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
