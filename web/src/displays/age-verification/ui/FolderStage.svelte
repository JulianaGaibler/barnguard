<!--
  The answers to a choice as portrait folders in a row across the middle of the
  screen, each with its label on the tab and its description on the page. Dana
  puts them on the desk: they drop onto each other in a stack, then the ones on
  the left and the right fan out to their places, turning a little outward. A tap lifts the folder it picks.
  Unlike the lettered list the engine draws nothing here, so the whole stage is
  markup that moves with the screen.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Engine } from 'stargazer'
  import type { ChoiceOption } from '../story/types'
  import { PALETTE } from '../theme'
  import { Entrance } from './entrance'
  import Folder from './Folder.svelte'

  interface Props {
    engine: Engine
    options: readonly ChoiceOption[]
    /** The answer just picked, which the stage lifts. */
    picked: string | null
    disabled: boolean
    ariaLabel: (letter: string, label: string) => string
    /** The font size of the answers' text, in design pixels. */
    fontSize: number
    onPick: (optionId: string) => void
  }
  const {
    engine,
    options,
    picked,
    disabled,
    ariaLabel,
    fontSize,
    onPick,
  }: Props = $props()

  const COLORS = [PALETTE.pink, PALETTE.mint, PALETTE.orange]
  /** The most a folder turns, in degrees, at the far end of the stack. */
  const TURN = 2
  /** The gap between folders, in em. */
  const GAP = 1.3
  const letterOf = (i: number): string => String.fromCharCode(65 + i)

  // The options are fixed for a stage's life, since a new screen mounts a new one.
  /* svelte-ignore state_referenced_locally */
  const drop = new Entrance(engine, options.length)
  // The fan starts once the stack has landed.
  /* svelte-ignore state_referenced_locally */
  const fan = new Entrance(engine, 1, 0.3 + 0.55)
  onDestroy(() => {
    drop.destroy()
    fan.destroy()
  })

  /** The middle of the stack, which stays put and on top. */
  /* svelte-ignore state_referenced_locally */
  const middle = (options.length - 1) / 2
  /** A folder's width, to know how far apart the places are. */
  let itemWidth = $state(0)
  const pitch = $derived(itemWidth + GAP * fontSize)

  /**
   * Where folder `i` is. It falls onto the middle of the stack from above, then
   * moves to its own place and turns.
   */
  const place = (i: number): string => {
    const fall = drop.v(i)
    const spread = fan.v(0)
    const y = (1 - fall) * -2.2 * fontSize
    const x = (1 - spread) * (middle - i) * pitch
    const lift =
      picked === options[i]!.id ? ' translateY(-0.25em) scale(1.03)' : ''
    return (
      `opacity: ${Math.min(fall * 2, 1)}; z-index: ${options.length - Math.round(Math.abs(i - middle))};` +
      ` transform: translate(${x}px, ${y}px) rotate(${spread * (i - middle) * TURN}deg)${lift}`
    )
  }
</script>

<ul
  class="folders"
  style:--answer-size="{fontSize}px"
  style:--count={options.length}
>
  {#each options as option, i (option.id)}
    <li
      class="folders__item"
      class:folders__item--picked={picked === option.id}
      class:folders__item--dim={picked !== null && picked !== option.id}
      style={place(i)}
      bind:clientWidth={itemWidth}
    >
      <button
        class="folders__button"
        aria-label={ariaLabel(
          letterOf(i),
          [option.label, option.description]
            .filter((part): part is string => !!part)
            .map((part) => part.replace(/\.$/, ''))
            .join('. '),
        )}
        {disabled}
        onclick={() => onPick(option.id)}
      >
        <Folder title={option.label} color={COLORS[i % COLORS.length]!}>
          {#if option.description}
            <p class="folders__text">{option.description}</p>
          {/if}
        </Folder>
      </button>
    </li>
  {/each}
</ul>

<style lang="sass">
  @use './type'

  .folders
    margin: 0
    padding: 0
    list-style: none
    display: flex
    justify-content: center
    align-items: center
    gap: 1.3em
    width: 100%
    height: 100%
    --count: 3
    font-size: var(--answer-size, 40px)

  // A portrait folder as tall as the stage and as wide as that makes it, unless
  // the row runs out of room. Its type scales with its width.
  .folders__item
    position: relative
    flex: none
    height: 100%
    max-width: calc((100% - (var(--count) - 1) * 1.3em) / var(--count))
    aspect-ratio: 3 / 4
    container-type: inline-size
    transition: opacity 0.2s ease

  .folders__item :global(.folder)
    font-size: 11cqw

  .folders__item--dim
    opacity: 0.35 !important

  .folders__button
    display: block
    width: 100%
    height: 100%
    padding: 0
    border: 0
    background: none
    color: inherit
    font: inherit
    text-align: start
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent
    transition: transform 0.14s ease

    &:active:not(:disabled)
      transform: translateY(0.12em) scale(0.985)

    &:disabled
      cursor: default

  .folders__text
    @include type.body
    font-size: 0.72em
    font-weight: 500
    margin: 0
</style>
