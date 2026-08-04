<!--
  Pre-game confirm card. Screen-space, bottom-anchored (not camera-projected),
  so the map placement transform never shifts it. Slides up when a state is
  selected; Start begins the round. Stripped to just the state name + Start.
-->
<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Button from '@src/core/ui/Button.svelte'
  import { DATA_CONTROL_STRINGS as t } from '../strings'
  import type { StateId } from '../game'

  interface Props {
    stateId: StateId
    onConfirm: () => void
  }
  const { stateId, onConfirm }: Props = $props()

  const stateName = $derived(t.states[stateId])

  // Stop pointer events from falling through to the map canvas underneath.
  function stopPointer(event: Event): void {
    event.stopPropagation()
  }
</script>

<div
  class="confirm-card__mount"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onpointerdown={stopPointer}
  transition:fly={{ y: 480, duration: 450, opacity: 1, easing: cubicOut }}
>
  <section class="confirm-card">
    <h2 class="confirm-card__state">{stateName}</h2>
    <Button variant="primary" onclick={onConfirm}>{t.start}</Button>
  </section>
</div>

<style lang="sass">
  .confirm-card__mount
    position: absolute
    inset-inline: 0
    inset-block-end: 0
    display: flex
    flex-direction: column
    align-items: center
    padding-block: 0 var(--space-24)
    padding-inline: var(--space-24)
    max-width: min(66.25rem, 50rem)
    margin-inline: auto
    // The card owns pointer events so touches inside don't leak to the map.
    pointer-events: auto
    z-index: var(--z-overlay)

  .confirm-card
    width: 100%
    display: flex
    align-items: center
    justify-content: space-between
    gap: var(--space-32)
    padding-block: var(--space-32)
    padding-inline: var(--space-48)
    border-radius: var(--radius-panel, 1rem)
    background: var(--color-surface-card)
    box-shadow: var(--color-shadow-panel)
    color: var(--color-text)

  .confirm-card__state
    @include tint.type-class(title-1)
    margin: 0
    line-height: 1.05
    font-family: tint.$mozilla-headline-extended
    font-weight: 700
</style>
