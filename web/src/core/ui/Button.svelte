<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'ghost'
    small?: boolean
    toggled?: boolean | undefined
    disabled?: boolean
    submit?: boolean
    onclick?: (e: MouseEvent) => void
    children?: import('svelte').Snippet
    class?: string
  }

  let {
    variant = 'secondary',
    small = false,
    toggled = undefined,
    disabled = false,
    submit = false,
    onclick = undefined,
    children,
    class: className = '',
    ...rest
  }: Props = $props()

  const role = $derived(toggled !== undefined ? 'switch' : undefined)
  const ariaPressed = $derived(toggled)
  // A toggled `secondary` button becomes visually primary when on, matching
  // tint's original behaviour.
  const effectiveVariant = $derived(
    toggled === undefined ? variant : toggled ? 'primary' : variant,
  )
</script>

<button
  {disabled}
  {role}
  aria-pressed={ariaPressed}
  class="btn {effectiveVariant} {className}"
  class:small
  type={submit ? 'submit' : 'button'}
  {onclick}
  {...rest}
>
  {@render children?.()}
</button>

<style lang="sass">
  .btn
    display: inline-flex
    align-items: center
    justify-content: center
    vertical-align: top
    box-sizing: border-box
    min-height: 48px
    padding: tint.$size-12 tint.$size-24
    background-color: transparent
    border: tint.$button-border-width solid var(--tint-action-secondary)
    color: var(--tint-action-secondary-text)
    // Fully-round pill; any value larger than `min-height / 2` maxes out.
    border-radius: 9999px
    flex-shrink: 0
    @include tint.type-class(action)
    font-size: 1.2rem
    // Override the action type-class's uppercase; the design asks for
    // the label in its original casing.
    text-transform: none
    cursor: pointer

    &:focus-visible
      @include tint.effect-focus-base

    &:not(:disabled):hover
      background-color: var(--tint-action-secondary-hover)
    &:not(:disabled):active
      background-color: var(--tint-action-secondary-active)

    &:disabled
      opacity: 0.5
      cursor: default

  .btn.small
    min-height: 32px
    padding: tint.$size-2 tint.$size-16
    // Keep the pill shape for the small variant too.
    border-radius: 9999px

  .btn.primary
    // Solid white pill with near-black label; high-contrast primary CTA
    // that reads cleanly on the pink/photo confirm card backdrop.
    background-color: #ffffff
    border-color: transparent
    color: #010612
    &:not(:disabled):hover
      background-color: rgba(255, 255, 255, 0.9)
    &:not(:disabled):active
      background-color: rgba(255, 255, 255, 0.8)

  .btn.ghost
    border-color: transparent

  @media (forced-colors: active)
    .btn
      forced-color-adjust: none
      background-color: ButtonFace
      border-color: ButtonText
      color: ButtonText
    .btn:not(:disabled):hover, .btn:not(:disabled):active
      background-color: SelectedItemText
      border-color: SelectedItem
      color: SelectedItem
    .btn:disabled
      opacity: 1
      background-color: ButtonFace
      border: 2px solid GrayText
      color: GrayText
    .btn.primary
      background-color: ButtonText
      border: 2px solid ButtonFace
      color: ButtonFace
</style>
