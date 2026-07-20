<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** Dim the screen behind the content and capture input (a modal). */
    scrim?: boolean
    /** Center the content in the viewport. */
    center?: boolean
    /** If set with `scrim`, clicking the backdrop calls this. */
    onscrimclick?: () => void
    class?: string
    children: Snippet
  }
  const {
    scrim = true,
    center = true,
    onscrimclick,
    class: className = '',
    children,
  }: Props = $props()
</script>

<div class="overlay {className}" class:scrim class:center>
  {#if scrim && onscrimclick}
    <button class="overlay__dismiss" aria-label="dismiss" onclick={onscrimclick}
    ></button>
  {/if}
  {@render children()}
</div>

<style lang="sass">
  // Full-screen layer. Non-modal by default (click-through); a scrim makes it a
  // modal that dims and captures input.
  .overlay
    position: absolute
    inset: 0
    z-index: var(--z-overlay)
    pointer-events: none

  .overlay.center
    display: flex
    align-items: center
    justify-content: center

  .overlay.scrim
    background: var(--color-scrim)
    pointer-events: auto

  .overlay__dismiss
    position: absolute
    inset: 0
    border: none
    background: transparent
    pointer-events: auto
    cursor: default
</style>
