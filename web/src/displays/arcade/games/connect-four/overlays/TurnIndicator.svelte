<!--
  Whose-turn banner at the top of the board. A colored dot plus a label; the dot
  pulses while the AI is thinking. Non-interactive.
-->
<script lang="ts">
  import { fade } from 'svelte/transition'

  interface Props {
    label: string
    /** Dot color (a `var(--color-team-*)` reference). */
    color: string
    /** Pulse the dot (AI is computing its move). */
    pulse: boolean
  }
  const { label, color, pulse }: Props = $props()
</script>

<div class="turn" transition:fade={{ duration: 150 }}>
  <span
    class="turn__dot"
    class:turn__dot--pulse={pulse}
    style="background: {color}"
  ></span>
  <span class="turn__label">{label}</span>
</div>

<style lang="sass">
  .turn
    position: absolute
    inset-block-start: var(--space-24)
    inset-inline-start: 50%
    transform: translateX(-50%)
    display: inline-flex
    align-items: center
    gap: var(--space-8)
    padding-block: var(--space-8)
    padding-inline: var(--space-16)
    border-radius: var(--radius-pill)
    background: var(--color-surface-card)
    box-shadow: var(--color-shadow-card)
    @include tint.type-class(pill)
    color: var(--color-text)
    pointer-events: none

  .turn__dot
    width: 0.875rem
    height: 0.875rem
    border-radius: var(--radius-pill)

  .turn__dot--pulse
    animation: turn-pulse 0.9s ease-in-out infinite

  @keyframes turn-pulse
    0%, 100%
      opacity: 1
      transform: scale(1)
    50%
      opacity: 0.4
      transform: scale(0.7)
</style>
