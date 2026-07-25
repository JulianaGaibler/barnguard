<!--
  A single key for `OnScreenKeyboard`. Commits its character on `pointerdown`;
  release is heard on `window` rather than the button itself, since a
  touchscreen's own `pointerup` can land on a different target, get dropped
  after the implicit touch capture, or get lost to a system gesture — any of
  which would leave the key looking stuck pressed.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  interface Props {
    label: string
    /** Accessible name, when `label` is a glyph rather than a letter. */
    ariaLabel?: string
    /** Raw SVG markup (a `?raw` import) shown instead of `label`, for the
     * non-letter keys (close, backspace, enter). */
    icon?: string
    onTap: () => void
    disabled?: boolean
  }
  const { label, ariaLabel = label, icon, onTap, disabled = false }: Props = $props()

  let active = $state(false)
  const activePointers = new SvelteSet<number>()
  let listening = false

  function attach(): void {
    if (listening) return
    listening = true
    window.addEventListener('pointerup', onWindowRelease)
    window.addEventListener('pointercancel', onWindowRelease)
  }
  function detach(): void {
    if (!listening) return
    listening = false
    window.removeEventListener('pointerup', onWindowRelease)
    window.removeEventListener('pointercancel', onWindowRelease)
  }
  function releasePointer(id: number): void {
    if (!activePointers.delete(id)) return
    if (active && activePointers.size === 0) {
      active = false
      detach()
    }
  }
  function onWindowRelease(e: PointerEvent): void {
    releasePointer(e.pointerId)
  }
  /** Force-release. Called on window blur / tab hide and on unmount, so a
   * pressed key can never outlive the component. */
  function clearAll(): void {
    detach()
    activePointers.clear()
    active = false
  }

  function down(e: PointerEvent): void {
    if (disabled) return
    e.preventDefault()
    activePointers.add(e.pointerId)
    attach()
    active = true
    onTap()
  }

  onMount(() => {
    const onWinBlur = (): void => clearAll()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') clearAll()
    }
    window.addEventListener('blur', onWinBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onWinBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      clearAll()
    }
  })
</script>

<button
  type="button"
  class="key"
  class:active
  {disabled}
  aria-label={ariaLabel}
  onpointerdown={down}
>
  {#if icon}
    {@html icon}
  {:else}
    {label}
  {/if}
</button>

<style lang="sass">
  .key
    display: flex
    align-items: center
    justify-content: center
    flex-shrink: 0
    width: var(--space-48)
    height: var(--space-64)
    background: var(--color-input-bg)
    border: none
    border-radius: var(--radius-card)
    color: var(--color-text)
    font-weight: 800
    text-transform: uppercase
    user-select: none
    -webkit-user-select: none
    touch-action: none
    cursor: pointer
    transition: transform 0.2s linear

    &.active
      transform: scale(1.2)
      background: color-mix(in srgb, var(--color-text) 16%, var(--color-input-bg))

    &:disabled
      opacity: 0.35
      cursor: not-allowed

    :global(svg)
      width: var(--space-16)
      height: var(--space-16)
      fill: currentColor
      display: block
</style>
