<!--
  A single key for `OnScreenKeyboard`. It only draws: the keyboard's gesture
  controller owns every pointer, so a key has no listeners and cannot be left
  pressed on its own. `data-key-id` is how the keyboard finds the key's box.
-->
<script lang="ts">
  import type { KeyVariant } from './keyboard/layout'

  interface Props {
    id: string
    label: string
    /** Accessible name, when `label` is a glyph rather than a letter. */
    ariaLabel?: string
    /** Raw SVG markup (a `?raw` import) shown instead of `label`. */
    icon?: string
    variant?: KeyVariant
    /** Grid columns the key spans. A letter spans 2. */
    span: number
    pressed?: boolean
    disabled?: boolean
  }
  const {
    id,
    label,
    ariaLabel = label,
    icon,
    variant = 'char',
    span,
    pressed = false,
    disabled = false,
  }: Props = $props()
</script>

<button
  type="button"
  class="key key--{variant}"
  class:pressed
  class:disabled
  data-key-id={id}
  style:grid-column="span {span}"
  aria-label={ariaLabel}
  aria-disabled={disabled}
  tabindex="-1"
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
    height: var(--space-64)
    padding: 0
    background: var(--color-input-bg)
    border: none
    border-radius: var(--radius-card)
    color: var(--color-text)
    font: inherit
    font-weight: 800
    user-select: none
    -webkit-user-select: none
    -webkit-touch-callout: none
    touch-action: none
    cursor: pointer

    &.key--fn
      background: color-mix(in srgb, var(--color-input-bg) 30%, transparent)

    &.key--enter
      background: var(--color-text)
      color: var(--color-input-bg)

    &.pressed
      background: color-mix(in srgb, var(--color-text) 16%, var(--color-input-bg))

    &.key--enter.pressed
      background: color-mix(in srgb, var(--color-input-bg) 24%, var(--color-text))

    // Only the label dims, so an empty field does not make the keys that
    // delete or space look switched off as a whole.
    &.disabled
      color: color-mix(in srgb, currentColor 35%, transparent)

    :global(svg)
      width: var(--space-16)
      height: var(--space-16)
      fill: currentColor
      display: block
</style>
