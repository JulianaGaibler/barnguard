<!--
  A hired card that offers a choice (fund a budget line vs. gain approvals, and
  so on). The turn pipeline is awaiting the answer and rejects if the match is
  torn down first, so this overlay just has to call `onPick` or `onCancel`.

  Backing out is a real answer here, since the question arrives after the card
  is already dropped into a seat and the player may only then read what it
  costs. Cancelling returns the candidate to the shortlist.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { FS_STRINGS as t } from '../strings'
  import type { ChoicePrompt } from '../game'
  import GlyphSpans from './GlyphSpans.svelte'

  interface Props {
    choice: ChoicePrompt
    onPick: (index: number) => void
    onCancel: () => void
  }
  const { choice, onPick, onCancel }: Props = $props()

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onCancel()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="fs-choice" transition:fade={{ duration: 150 }}>
  <div
    class="fs-choice__card"
    transition:scale={{ start: 0.94, duration: 200 }}
  >
    <Surface tone="light">
      <div class="fs-choice__body">
        <h2 class="fs-choice__title">{choice.card.name}</h2>
        <p class="fs-choice__sub">{t.chooseOne}</p>
        <div class="fs-choice__options">
          {#each choice.options as option, i (i)}
            <button class="fs-choice__option" onclick={() => onPick(i)}>
              <GlyphSpans spans={option} />
            </button>
          {/each}
        </div>
        <Button variant="secondary" onclick={onCancel}>{t.cancel}</Button>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .fs-choice
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .fs-choice__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48)
    padding-inline: var(--space-32)
    max-width: 92vw

  .fs-choice__title
    @include tint.type-class(headline)
    color: var(--color-title)
    margin: 0

  .fs-choice__sub
    @include tint.type-class(body-small)
    color: var(--color-text-secondary)
    margin: 0

  .fs-choice__options
    display: flex
    gap: var(--space-16)

  .fs-choice__option
    flex: 1
    min-width: 14rem
    max-width: 20rem
    padding: var(--space-24)
    border: 2px solid var(--color-border)
    border-radius: var(--radius-card)
    background: var(--color-surface-card)
    color: var(--color-text)
    cursor: pointer
    @include tint.type-class(body)

    &:hover
      border-color: var(--color-accent)

    :global(strong)
      color: var(--color-accent)
</style>
