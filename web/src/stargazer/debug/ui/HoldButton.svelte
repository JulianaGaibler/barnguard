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
  // Pointer IDs currently pressing this button. Multiple fingers on the same
  // button must not release the press until the *last* lifts; different buttons
  // track their own IDs, so two fingers on Up + Right pan diagonally.
  const activePointers = new SvelteSet<number>()
  // Whether the window-level release listeners are attached (only while held).
  let listening = false

  // Release is heard on `window`, NOT on the button. On touchscreens the
  // element's own `pointerup` is unreliable, it can fire on a different target,
  // get dropped after the implicit touch capture, or be lost on a system
  // gesture, leaving the button "stuck" (for the camera pad, the debug camera
  // then pans forever). A window listener keyed by `pointerId` catches the
  // release wherever it lands. See the camera pad in `DebugHud.svelte`.
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

  function down(e: PointerEvent): void {
    if (disabled) return
    // Prevent the synthetic mouse/focus follow-up; keyboard focus must never
    // land on a pad button (WASD/QE must reach DebugController).
    e.preventDefault()
    activePointers.add(e.pointerId)
    attach()
    if (!active) {
      active = true
      onPress()
    }
  }

  function releasePointer(id: number): void {
    if (!activePointers.delete(id)) return
    if (active && activePointers.size === 0) {
      active = false
      detach()
      onRelease()
    }
  }

  function onWindowRelease(e: PointerEvent): void {
    releasePointer(e.pointerId)
  }

  /**
   * Force-release everything. Called on window blur / tab hide (the browser
   * drops pointer events on a background tab, incoming call, home-indicator
   * swipe) and on unmount, so a held key can never outlive the button.
   */
  function clearAll(): void {
    detach()
    activePointers.clear()
    if (active) {
      active = false
      onRelease()
    }
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
      // Unmounting mid-press (e.g. the section collapses) must still release.
      clearAll()
    }
  })
</script>

<button
  type="button"
  class="hold-btn"
  class:active
  {disabled}
  aria-label={ariaLabel}
  onpointerdown={down}
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
