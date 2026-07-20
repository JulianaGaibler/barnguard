<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** Light card or dark inverse panel. */
    tone?: 'light' | 'inverse'
    /** Corner rounding: small card vs large panel. */
    radius?: 'card' | 'panel'
    /** Frost the backdrop, to separate the card from the moving canvas beneath. */
    blur?: boolean
    class?: string
    children: Snippet
  }
  const {
    tone = 'light',
    radius = 'panel',
    blur = false,
    class: className = '',
    children,
  }: Props = $props()
</script>

<div
  class="surface {tone} {className}"
  class:blur
  style="--surface-radius: var(--radius-{radius})"
>
  {@render children()}
</div>

<style lang="sass">
  .surface
    border-radius: var(--surface-radius)
    box-shadow: var(--color-shadow-card)
    overflow: hidden

  .surface.light
    background: var(--color-surface-card)
    color: var(--color-text)

  .surface.inverse
    background: var(--color-surface-inverse)
    color: var(--color-text-inverse)

  .surface.blur
    backdrop-filter: blur(0.75rem)
</style>
