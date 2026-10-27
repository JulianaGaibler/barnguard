<!--
  The answers to a choice as people to talk to, each a conference badge: a
  card with a punched hole, a letter, and the name in big condensed type at the
  bottom. They drop in one after another and bob a little while they wait, and
  the one picked stands taller. A person already met is grey with a tick, and
  can't be picked. Badges stay square to the screen, since a turned edge would
  be drawn jagged.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Engine } from 'stargazer'
  import type { ChoiceOption } from '../story/types'
  import { PALETTE } from '../theme'
  import { Entrance } from './entrance'

  interface Props {
    engine: Engine
    options: readonly ChoiceOption[]
    /** The ids of the answers already taken, which can't be picked. */
    done?: ReadonlySet<string>
    /** What a screen reader says of an answer that is taken. */
    doneLabel?: string
    /** The answer just picked, which stands taller. */
    picked: string | null
    disabled: boolean
    ariaLabel: (letter: string, label: string) => string
    /** The font size of the names, in design pixels. */
    fontSize: number
    onPick: (optionId: string) => void
  }
  const {
    engine,
    options,
    done = new Set<string>(),
    doneLabel = '',
    picked,
    disabled,
    ariaLabel,
    fontSize,
    onPick,
  }: Props = $props()

  // The card's color and the ink on it.
  const BADGES = [
    { card: PALETTE.orange, ink: PALETTE.black },
    { card: PALETTE.black, ink: PALETTE.white },
    { card: PALETTE.pink, ink: PALETTE.black },
    { card: PALETTE.mint, ink: PALETTE.black },
  ]
  const letterOf = (i: number): string => String.fromCharCode(65 + i)

  // The options are fixed for a stage's life, since a new screen mounts a new one.
  /* svelte-ignore state_referenced_locally */
  const entrance = new Entrance(engine, options.length)
  onDestroy(() => entrance.destroy())

  /** A badge drops in from above and settles. */
  const enter = (i: number): string => {
    const v = entrance.v(i)
    return `opacity: ${Math.min(v * 2, 1)}; transform: translateY(${(v - 1) * 2.5}em)`
  }
</script>

<ul class="people" style:--answer-size="{fontSize}px">
  {#each options as option, i (option.id)}
    {@const taken = done.has(option.id)}
    <li
      class="people__item"
      class:people__item--picked={picked === option.id}
      class:people__item--dim={picked !== null && picked !== option.id}
      class:people__item--done={taken}
      style={enter(i)}
    >
      <button
        class="people__button"
        aria-label={ariaLabel(
          letterOf(i),
          [option.label, taken && doneLabel]
            .filter((part): part is string => !!part)
            .map((part) => part.replace(/\.$/, ''))
            .join('. '),
        )}
        disabled={disabled || taken}
        onclick={() => onPick(option.id)}
      >
        <span
          class="people__badge"
          style:--card={taken ? '#d9d9d9' : BADGES[i % BADGES.length]!.card}
          style:--ink={taken ? '#6b6b6b' : BADGES[i % BADGES.length]!.ink}
          style:--bob-delay="{i * -0.7}s"
        >
          <span class="people__hole"></span>
          <span class="people__letter">{letterOf(i)}</span>
          {#if taken}
            <svg class="people__tick" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 12.5 L9.5 18 L20 6"
                fill="none"
                stroke="currentColor"
                stroke-width="3.2"
              />
            </svg>
          {/if}
          <span class="people__name">{option.label}</span>
        </span>
      </button>
    </li>
  {/each}
</ul>

<style lang="sass">
  @use './type'

  .people
    margin: 0
    padding: 0
    list-style: none
    display: flex
    justify-content: center
    align-items: flex-start
    gap: 0.9em
    width: 100%
    font-size: var(--answer-size, 40px)

  .people__item
    flex: 1 1 0
    min-width: 0
    max-width: 7.6em
    transition: opacity 0.2s ease

  .people__item--dim
    opacity: 0.3 !important

  .people__button
    display: block
    width: 100%
    padding: 0
    border: 0
    background: none
    color: inherit
    font: inherit
    text-align: start
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent
    transition: transform 0.16s ease

    &:active:not(:disabled)
      transform: scale(0.96)

    &:disabled
      cursor: default

  // Standing taller: the picked badge rises.
  .people__item--picked .people__button
    transform: translateY(-0.2em) scale(1.06)

  .people__badge
    position: relative
    display: flex
    flex-direction: column
    justify-content: flex-end
    aspect-ratio: 5 / 7
    padding: 0.6em 0.5em 0.55em
    border-radius: 0.28em
    background: var(--card)
    color: var(--ink)
    animation: bob 2.6s ease-in-out infinite alternate
    animation-delay: var(--bob-delay, 0s)

  .people__item--done .people__badge
    animation: none

  // The slot the lanyard clip goes through.
  .people__hole
    position: absolute
    top: 0.55em
    left: 50%
    width: 1.1em
    height: 0.28em
    margin-left: -0.55em
    border-radius: 0.14em
    background: var(--color-surface, #fff)

  .people__letter
    @include type.letter
    position: absolute
    top: 0.9em
    left: 0.5em
    font-size: 1.1em
    line-height: 1
    opacity: 0.55

  .people__tick
    position: absolute
    top: 0.85em
    right: 0.5em
    width: 1.1em
    height: 1.1em

  @keyframes bob
    from
      transform: translateY(0)
    to
      transform: translateY(-0.12em)

  .people__name
    @include type.letter
    display: block
    font-size: 1.35em
    line-height: 0.95
    overflow-wrap: anywhere
</style>
