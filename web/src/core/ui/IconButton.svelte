<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** Accessible label (icon-only button). */
    label: string
    tone?: 'inverse' | 'surface'
    onclick?: () => void
    /** The icon. */
    children: Snippet
  }
  const { label, tone = 'inverse', onclick, children }: Props = $props()
</script>

<button class="icon-btn {tone}" aria-label={label} {onclick}>
  {@render children()}
</button>

<style lang="sass">
  .icon-btn
    display: inline-flex
    align-items: center
    justify-content: center
    flex-shrink: 0
    width: var(--space-48)
    height: var(--space-48)
    border: none
    border-radius: var(--radius-pill)
    cursor: pointer

    &:focus-visible
      @include tint.effect-focus-base

  .icon-btn.inverse
    background: var(--color-surface-inverse)
    color: var(--color-text-inverse)
    &:active
      filter: brightness(1.35)

  .icon-btn.surface
    background: var(--color-surface-card)
    color: var(--color-text)
    box-shadow: var(--color-shadow-card)
    &:active
      filter: brightness(0.95)
</style>
