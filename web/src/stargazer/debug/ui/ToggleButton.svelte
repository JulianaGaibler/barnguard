<script lang="ts">
  interface Props {
    active: boolean
    onToggle: () => void
    label: string
    /** Short keyboard hint shown as a <kbd> chip on the left. Optional. */
    hint?: string
    disabled?: boolean
  }

  let { active, onToggle, label, hint, disabled = false }: Props = $props()

  // Prevent the button from stealing keyboard focus on click. Focus theft on
  // a desktop workflow would drop WASD/QE keystrokes on the button element
  // and (indirectly) into DebugController's key filter. Click event still
  // fires normally after this preventDefault, only focus is suppressed.
  function suppressFocus(e: PointerEvent): void {
    e.preventDefault()
  }
  function handleClick(e: MouseEvent): void {
    onToggle()
    ;(e.currentTarget as HTMLButtonElement).blur()
  }
</script>

<button
  type="button"
  class="toggle-btn"
  class:active
  {disabled}
  onpointerdown={suppressFocus}
  onclick={handleClick}
>
  {#if hint}<kbd class="hint">{hint}</kbd>{/if}
  <span class="label">{label}</span>
  <span class="state" class:on={active}>{active ? 'on' : 'off'}</span>
</button>

<style lang="sass">
  .toggle-btn
    display: flex
    align-items: center
    gap: 6px
    padding: 6px 8px
    width: 100%
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: 4px
    color: #fff
    font-family: inherit
    font-size: 11px
    text-align: left
    user-select: none
    -webkit-user-select: none
    touch-action: manipulation
    cursor: pointer
    min-height: 36px

    &:hover:not(:disabled)
      background: rgba(255, 255, 255, 0.1)
      border-color: rgba(255, 255, 255, 0.35)

    &:disabled
      opacity: 0.4
      cursor: not-allowed

    &.active
      background: rgba(96, 165, 250, 0.18)
      border-color: rgba(96, 165, 250, 0.55)

  .hint
    min-width: 2ch
    padding: 1px 4px
    font-size: 10px
    // Reset panel-level kbd margin so it sits flush.
    margin: 0

  .label
    flex: 1

  .state
    font-size: 10px
    padding: 1px 5px
    border-radius: 2px
    background: rgba(255, 255, 255, 0.08)
    color: rgba(255, 255, 255, 0.55)
    text-transform: uppercase

    &.on
      background: rgba(74, 222, 128, 0.2)
      color: #4ade80
</style>
