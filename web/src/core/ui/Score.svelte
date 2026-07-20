<script lang="ts">
  interface Props {
    left: number
    right: number
  }
  const { left, right }: Props = $props()
</script>

<div class="score">
  <span class="score__l">{left}</span>
  <span class="score__sep">:</span>
  <span class="score__r">{right}</span>
</div>

<style lang="sass">
  // Team-colored, tabular score pair (left = team A, right = team B).
  .score
    @include tint.type-class(score)

  .score__l
    color: var(--color-team-a)

  .score__r
    color: var(--color-team-b)

  .score__sep
    color: var(--color-text-secondary)
    margin-inline: var(--space-12)
</style>
