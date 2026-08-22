<!--
  A hired card that offers a choice (fund a budget line vs. gain approvals, and
  so on). The turn pipeline is awaiting the pick, and rejects if the match is
  torn down first, so this overlay just has to call `onPick`.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Surface from '@src/core/ui/Surface.svelte'
  import { OO_STRINGS as t } from '../strings'
  import type { ChoicePrompt } from '../game'

  interface Props {
    choice: ChoicePrompt
    onPick: (index: number) => void
  }
  const { choice, onPick }: Props = $props()
</script>

<div class="oo-choice" transition:fade={{ duration: 150 }}>
  <div
    class="oo-choice__card"
    transition:scale={{ start: 0.94, duration: 200 }}
  >
    <Surface tone="light">
      <div class="oo-choice__body">
        <h2 class="oo-choice__title">{choice.card.name}</h2>
        <p class="oo-choice__sub">{t.chooseOne}</p>
        <div class="oo-choice__options">
          {#each choice.options as option, i (i)}
            <button class="oo-choice__option" onclick={() => onPick(i)}>
              {#each option as span, j (j)}{#if span.bold}<strong
                    >{span.text}</strong
                  >{:else}{span.text}{/if}{/each}
            </button>
          {/each}
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .oo-choice
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .oo-choice__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-48)
    padding-inline: var(--space-32)
    max-width: 92vw

  .oo-choice__title
    @include tint.type-class(headline)
    color: var(--color-title)
    margin: 0

  .oo-choice__sub
    @include tint.type-class(body-small)
    color: var(--color-text-secondary)
    margin: 0

  .oo-choice__options
    display: flex
    gap: var(--space-16)

  .oo-choice__option
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

    strong
      color: var(--color-accent)
</style>
