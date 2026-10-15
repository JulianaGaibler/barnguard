<!--
  The last seconds before an idle screen returns to the start. A pill slides
  down from the top edge with a ring draining beside it. Any touch restarts the
  idle clock, which takes the notice away, so the pill takes no taps itself.
-->
<script lang="ts">
  import { fly } from 'svelte/transition'
  import { expoOut } from 'svelte/easing'
  import { t } from '@src/displays/enterprise/i18n'
  import { IDLE_WARN_MS } from '@src/displays/enterprise/game/flow/screenFlow'

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
    <span>{$t.game.idleReturning}</span>
    <!-- Created the moment the countdown starts, so the drain needs no clock of
         its own to stay in step with the return. -->
    <svg class="idle__ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="idle__ring-track" cx="12" cy="12" r={RADIUS} />
      <circle class="idle__ring-drain" cx="12" cy="12" r={RADIUS} />
    </svg>
  </div>
{/if}

<style lang="sass">
  .idle
    position: absolute
    inset-block-start: var(--space-16)
    inset-inline-start: 50%
    transform: translateX(-50%)
    z-index: var(--z-overlay)
    display: inline-flex
    align-items: center
    gap: var(--space-12)
    pointer-events: none
    border-radius: 999px
    padding-block: var(--space-8)
    padding-inline: var(--space-24)
    font-family: var(--font-mozilla-text)
    font-weight: 700
    font-size: 1.25rem
    color: #15141a
    background: #ffffff
    box-shadow: var(--color-shadow-card)
    white-space: nowrap

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
    stroke: rgba(21, 20, 26, 0.15)

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
</style>
