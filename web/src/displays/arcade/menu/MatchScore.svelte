<!--
  Compact match-score shown under the menu title: two number tiles separated by
  a colon, each with a small team-color dot beneath. Rendered by MenuScreen only
  when a running score exists and is past 0:0. `bump` pulses the side that just
  scored.
-->
<script lang="ts">
  interface Props {
    left: number
    right: number
    leftColor: string
    rightColor: string
    /** Side that just scored, pulses its tile on mount. */
    bump?: 'left' | 'right' | null
  }
  const { left, right, leftColor, rightColor, bump = null }: Props = $props()
</script>

<div class="score">
  <div class="score__tile" class:score__tile--bump={bump === 'left'}>
    <span class="score__num">{left}</span>
    <span class="score__dot" style="background: {leftColor}"></span>
  </div>
  <span class="score__sep">:</span>
  <div class="score__tile" class:score__tile--bump={bump === 'right'}>
    <span class="score__num">{right}</span>
    <span class="score__dot" style="background: {rightColor}"></span>
  </div>
</div>

<style lang="sass">
  .score
    display: inline-flex
    align-items: center
    gap: var(--space-8)
    padding: var(--space-12)
    border-radius: var(--radius-panel)
    background: color-mix(in srgb, var(--color-surface-card) 50%, transparent)

  .score__tile
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-4)
    min-width: 3rem
    padding: var(--space-12) var(--space-16)
    border-radius: calc(var(--radius-panel) - var(--space-12))
    background: var(--color-surface-card)

  .score__tile--bump
    animation: score-bump 1s cubic-bezier(0.16, 1, 0.3, 1)

  .score__num
    @include tint.type-class(headline)
    color: var(--color-text)
    line-height: 1

  .score__dot
    width: 0.5rem
    height: 0.5rem
    border-radius: var(--radius-pill)

  .score__sep
    @include tint.type-class(headline)
    color: var(--color-text-secondary)

  @keyframes score-bump
    0%
      transform: scale(1)
    20%, 80%
      transform: scale(1.4)
    100%
      transform: scale(1)
</style>
