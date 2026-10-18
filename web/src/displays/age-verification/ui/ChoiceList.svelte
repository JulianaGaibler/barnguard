<!--
  The answers to a choice, lettered from A. The whole row takes the tap, and
  the picked row flashes before the next screen comes in.
-->
<script lang="ts">
  import type { ChoiceOption } from '../story/types'

  interface Props {
    options: readonly ChoiceOption[]
    /** The option just picked, shown highlighted while the screen leaves. */
    picked: string | null
    disabled: boolean
    ariaLabel: (letter: string, label: string) => string
    onPick: (optionId: string) => void
  }
  const { options, picked, disabled, ariaLabel, onPick }: Props = $props()

  const letterOf = (i: number): string => String.fromCharCode(65 + i)
</script>

<ol class="choices">
  {#each options as option, i (option.id)}
    <li>
      <button
        class="choice"
        class:choice--picked={picked === option.id}
        aria-label={ariaLabel(letterOf(i), option.label)}
        {disabled}
        onclick={() => onPick(option.id)}
      >
        <span class="choice__letter" aria-hidden="true">{letterOf(i)}</span>
        <span class="choice__label" aria-hidden="true">{option.label}</span>
      </button>
    </li>
  {/each}
</ol>

<style lang="sass">
  @use './type'

  .choices
    display: flex
    flex-direction: column
    gap: 63px
    margin: 0
    padding: 0
    list-style: none

  .choice
    display: flex
    align-items: flex-start
    width: 100%
    padding: 0
    border: 0
    background: none
    color: var(--color-text)
    text-align: start
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:disabled
      cursor: default

  .choice__letter
    @include type.letter
    display: flex
    flex: 0 0 128px
    align-items: center
    justify-content: center
    height: 128px
    color: var(--color-text-inverse)
    background: var(--color-surface-inverse)
    transition: background 0.15s

  .choice__label
    @include type.option
    flex: 1
    padding: 24px

  .choice--picked .choice__letter
    background: var(--color-accent)

  .choice--picked .choice__label
    color: var(--color-accent)
</style>
