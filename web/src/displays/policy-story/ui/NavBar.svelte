<!--
  The row along the bottom: on the right, the way forward from a screen with no
  choice. A choice has no button, because tapping an answer moves on.
-->
<script lang="ts">
  import type { ButtonStyle } from '../story/types'

  interface Action {
    label: string
    onPress: () => void
    /** Default `plain`. A thought is italic. */
    style?: ButtonStyle
  }

  interface Props {
    /** Continue or Start over, on a screen with no choice. */
    forward?: Action
    disabled: boolean
  }
  const { forward, disabled }: Props = $props()
</script>

<nav class="nav">
  {#if forward}
    <button
      class="nav__button"
      class:nav__button--thought={forward.style === 'thought'}
      {disabled}
      onclick={forward.onPress}
    >
      {forward.label}
    </button>
  {/if}
</nav>

<style lang="sass">
  @use './type'

  .nav
    display: flex
    align-items: center
    justify-content: var(--nav-justify, flex-start)

  // The way forward is set like an answer: only its text, in the action color,
  // underlined while it is pointed at.
  .nav__button
    @include type.option
    font-size: var(--answer-size, 36px)
    display: flex
    align-items: center
    justify-content: center
    height: var(--nav-height, 64px)
    padding: 0.4em 0
    border: 0
    color: var(--color-accent)
    background: none
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:hover,
    &:focus-visible,
    &:active
      text-decoration: underline
      text-decoration-thickness: 0.07em
      text-underline-offset: 0.22em

  .nav__button--thought
    font-style: italic
</style>
