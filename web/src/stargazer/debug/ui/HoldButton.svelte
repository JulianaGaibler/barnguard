<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  interface Props {
    onPress: () => void
    onRelease: () => void
    ariaLabel?: string
    disabled?: boolean
    children: Snippet
  }

  let {
    onPress,
    onRelease,
    ariaLabel,
    disabled = false,
    children,
  }: Props = $props()

  let active = $state(false)
  // Track pointer IDs currently pressing this button. Multiple fingers on the
  // same button (rare but possible on a 20-finger panel) must not release the
  // press until the *last* finger lifts. Different buttons capture their own
  // pointer IDs independently, so two fingers on Up + Right pan diagonally.
  const activePointers = new SvelteSet<number>()
  // Reference to the underlying <button>, used to release any lingering
  // captures during a full clear (blur / visibilitychange).
  let btnEl: HTMLButtonElement | undefined = $state(undefined)

  function down(e: PointerEvent): void {
    if (disabled) return
    e.preventDefault()
    // Capture on the button so a finger sliding off doesn't strand the press;
    // pointerup then fires on this element wherever the release happens.
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    activePointers.add(e.pointerId)
    if (!active) {
      active = true
      onPress()
    }
  }

  function up(e: PointerEvent): void {
    activePointers.delete(e.pointerId)
    if (active && activePointers.size === 0) {
      active = false
      onRelease()
    }
  }

  /**
   * Belt-and-braces release. Called on `pointerleave` and from the global blur
   * / visibilitychange listeners. Touchscreen browsers (esp. Android Firefox
   * mid-gesture, iOS Safari on system swipes / notifications) sometimes drop
   * the `pointerup` / `pointercancel` after a `pointerdown` , that leaves the
   * button "stuck active", which for the camera pad means the debug camera pans
   * forever. Force-clear all state so the caller's `onRelease` fires and any
   * lingering pointer captures on this element are released.
   */
  function clearAll(): void {
    if (activePointers.size === 0 && !active) return
    if (btnEl) {
      for (const id of activePointers) {
        try {
          btnEl.releasePointerCapture(id)
        } catch {
          // Capture may already be gone (e.g. element detached); ignore.
        }
      }
    }
    activePointers.clear()
    if (active) {
      active = false
      onRelease()
    }
  }

  onMount(() => {
    // Global fallbacks, the browser silently drops pointer events in a
    // handful of scenarios (tab hidden, window blur, incoming call on
    // mobile, iOS home-indicator swipe). Without these, the press never
    // ends.
    const onWinBlur = (): void => clearAll()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') clearAll()
    }
    window.addEventListener('blur', onWinBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onWinBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })
</script>

<button
  bind:this={btnEl}
  type="button"
  class="hold-btn"
  class:active
  {disabled}
  aria-label={ariaLabel}
  onpointerdown={down}
  onpointerup={up}
  onpointercancel={up}
  onpointerleave={up}
>
  {@render children()}
</button>

<style lang="sass">
  .hold-btn
    display: flex
    align-items: center
    justify-content: center
    background: rgba(255, 255, 255, 0.08)
    border: 1px solid rgba(255, 255, 255, 0.22)
    border-radius: 4px
    color: #fff
    font-family: inherit
    font-size: 15px
    font-weight: 600
    line-height: 1
    padding: 0
    min-width: 36px
    min-height: 36px
    user-select: none
    -webkit-user-select: none
    touch-action: none
    cursor: pointer

    &:hover:not(:disabled)
      background: rgba(255, 255, 255, 0.14)
      border-color: rgba(255, 255, 255, 0.4)

    &.active
      background: rgba(96, 165, 250, 0.4)
      border-color: rgba(96, 165, 250, 0.85)
      transform: translateY(1px)

    &:disabled
      opacity: 0.35
      cursor: not-allowed
</style>
