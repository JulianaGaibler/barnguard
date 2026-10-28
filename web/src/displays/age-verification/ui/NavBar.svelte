<!--
  The row along the bottom: Back on the left, and on the right the way
  forward from a screen with no choice, then Home. A screen with no way back
  leaves the left empty.
-->
<script lang="ts">
  interface Action {
    label: string
    onPress: () => void
    /** Off on its own, as for a form that isn't filled in yet. */
    disabled?: boolean
  }

  interface Props {
    back?: Action
    /** Continue or Start over, on a screen with no choice. */
    forward?: Action
    /** Left out where `forward` already goes home. */
    home?: Action
    disabled: boolean
  }
  const { back, forward, home, disabled }: Props = $props()
</script>

<nav class="nav">
  {#if back}
    <button
      class="nav__button nav__button--filled"
      disabled={disabled || back.disabled}
      class:nav__button--off={back.disabled}
      onclick={back.onPress}
    >
      {back.label}
    </button>
  {:else}
    <span></span>
  {/if}
  <div class="nav__end">
    {#if forward}
      <button
        class="nav__button nav__button--filled"
        disabled={disabled || forward.disabled}
        class:nav__button--off={forward.disabled}
        onclick={forward.onPress}
      >
        {forward.label}
      </button>
    {/if}
    {#if home}
      <button
        class="nav__button"
        disabled={disabled || home.disabled}
        class:nav__button--off={home.disabled}
        onclick={home.onPress}
      >
        {home.label}
      </button>
    {/if}
  </div>
</nav>

<style lang="sass">
  @use './type'

  .nav
    display: flex
    align-items: center
    justify-content: space-between

  .nav__end
    display: flex
    gap: 32px

  .nav__button
    @include type.button
    display: flex
    align-items: center
    justify-content: center
    height: var(--nav-height, 64px)
    padding: 20px 32px
    border: 2px solid var(--color-accent)
    color: var(--color-accent)
    background: transparent
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:active
      background: var(--color-action-secondary-active)

  .nav__button--filled
    color: var(--color-action-primary-text)
    background: var(--color-action-primary)

    &:active
      background: var(--color-action-primary-active)

  // Only an action switched off on its own looks it. The whole row goes off
  // during every screen change, too briefly to show.
  .nav__button--off
    opacity: 0.4
    cursor: default
</style>
