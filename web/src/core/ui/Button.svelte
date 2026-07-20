<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Props = HTMLButtonAttributes & {
    /** Visual role. `surface` is the elevated white/surface pill (return pills). */
    variant?: 'primary' | 'secondary' | 'ghost' | 'surface'
    /** Corner style. Default is a full pill. */
    shape?: 'pill' | 'rounded'
    small?: boolean
    toggled?: boolean | undefined
    disabled?: boolean
    submit?: boolean
    onclick?: (e: MouseEvent) => void
    /** Optional icon rendered before the label. */
    leadingIcon?: Snippet
    children?: Snippet
    class?: string
  }

  let {
    variant = 'secondary',
    shape = 'pill',
    small = false,
    toggled = undefined,
    disabled = false,
    submit = false,
    onclick = undefined,
    leadingIcon,
    children,
    class: className = '',
    ...rest
  }: Props = $props()

  const role = $derived(toggled !== undefined ? 'switch' : undefined)
  const ariaPressed = $derived(toggled)
  // A toggled secondary button reads as primary when on.
  const effectiveVariant = $derived(
    toggled === undefined ? variant : toggled ? 'primary' : variant,
  )
</script>

<button
  {disabled}
  {role}
  aria-pressed={ariaPressed}
  class="btn {effectiveVariant} {shape} {className}"
  class:small
  type={submit ? 'submit' : 'button'}
  {onclick}
  {...rest}
>
  {#if leadingIcon}
    <span class="btn__icon" aria-hidden="true">{@render leadingIcon()}</span>
  {/if}
  {@render children?.()}
</button>

<style lang="sass">
  .btn
    display: inline-flex
    align-items: center
    justify-content: center
    gap: var(--space-8)
    vertical-align: top
    box-sizing: border-box
    min-height: var(--space-48)
    padding-block: var(--space-12)
    padding-inline: var(--space-24)
    background-color: transparent
    border: var(--space-2) solid var(--color-action-secondary)
    color: var(--color-action-secondary-text)
    border-radius: var(--radius-pill)
    flex-shrink: 0
    @include tint.type-class(button)
    cursor: pointer

    &:focus-visible
      @include tint.effect-focus-base
    &:not(:disabled):hover
      background-color: var(--color-action-secondary-hover)
    &:not(:disabled):active
      background-color: var(--color-action-secondary-active)
    &:disabled
      opacity: 0.5
      cursor: default

  .btn.rounded
    border-radius: var(--radius-card)

  .btn.small
    min-height: var(--space-32)
    padding-block: var(--space-8)
    padding-inline: var(--space-16)

  .btn__icon
    display: inline-flex
    align-items: center

  .btn.primary
    background-color: var(--color-action-primary)
    border-color: transparent
    color: var(--color-action-primary-text)
    &:not(:disabled):hover
      background-color: var(--color-action-primary-hover)
    &:not(:disabled):active
      background-color: var(--color-action-primary-active)

  // Elevated white/surface pill (e.g. "Return to Launcher"). Overrides the base
  // hover so it stays light (no dark overlay); a touch UI presses, not hovers.
  .btn.surface
    background-color: var(--color-surface-card)
    border-color: transparent
    color: var(--color-text)
    box-shadow: var(--color-shadow-card)
    &:not(:disabled):hover
      background-color: var(--color-surface-card)
      filter: brightness(0.97)
    &:not(:disabled):active
      background-color: var(--color-surface-card)
      filter: brightness(0.92)

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
    .btn.primary, .btn.surface
      background-color: ButtonText
      border: 2px solid ButtonFace
      color: ButtonFace
</style>
