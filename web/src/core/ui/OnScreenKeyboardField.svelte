<!--
  A tap-to-open text field for kiosk touchscreens: displays the current value
  and, in place of real DOM focus, slides `OnScreenKeyboard` up from the
  bottom edge of the nearest positioned ancestor instead of triggering the
  OS's own keyboard. Every game overlay is a full-window `position: absolute`
  scrim, so that's the "window" this anchors to. The keyboard's own trailing
  key forces it back closed.
-->
<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import OnScreenKeyboard from './OnScreenKeyboard.svelte'

  interface Props {
    value: string
    maxLength: number
    placeholder?: string
    closeLabel?: string
    onSubmit?: () => void
    /**
     * Externally controllable, so a caller can open the sheet from its own
     * trigger (e.g. a leaderboard row) instead of the default input below.
     */
    open?: boolean
    /**
     * Set false to drive `open` entirely from outside and skip the default
     * input button.
     */
    showTrigger?: boolean
  }
  let {
    value = $bindable(),
    maxLength,
    placeholder = '',
    closeLabel = 'Close keyboard',
    onSubmit,
    open = $bindable(false),
    showTrigger = true,
  }: Props = $props()

  function submit(): void {
    onSubmit?.()
    open = false
  }

  // Slides by the sheet's own rendered height rather than a fixed distance,
  // so it always clears the edge fully regardless of keyboard/content size.
  function slideFromEdge(
    node: HTMLElement,
    { duration = 220 }: { duration?: number } = {},
  ) {
    const height = node.getBoundingClientRect().height
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `transform: translateY(${(1 - t) * height}px)`,
    }
  }
</script>

{#if showTrigger}
  <button
    type="button"
    class="kbfield__input"
    class:open
    onclick={() => (open = true)}
  >
    <span class="kbfield__value"
      >{value ? value.toUpperCase() : placeholder}</span
    >
  </button>
{/if}

{#if open}
  <div class="kbfield__sheet" transition:slideFromEdge>
    <OnScreenKeyboard
      bind:value
      {maxLength}
      onSubmit={submit}
      onClose={() => (open = false)}
      {closeLabel}
    />
  </div>
{/if}

<style lang="sass">
  .kbfield__input
    display: flex
    align-items: center
    justify-content: center
    width: 100%
    height: var(--space-48)
    padding-inline: var(--space-16)
    border: none
    border-radius: var(--radius-input)
    background: var(--color-input-bg)
    box-shadow: var(--color-shadow-card)
    outline: 2px solid transparent
    outline-offset: 2px
    cursor: pointer

    &.open
      @include tint.effect-focus-base

  .kbfield__value
    @include tint.type-class(pill)
    letter-spacing: 0.3em
    color: var(--color-text)

  // The keyboard sizes itself (fixed-size square keys); this just centers it
  // rather than forcing a width, so it can never overflow its own content.
  .kbfield__sheet
    position: absolute
    inset-inline: 0
    inset-block-end: 0
    display: flex
    justify-content: center
    padding: var(--space-16) var(--space-24) var(--space-24)
</style>
