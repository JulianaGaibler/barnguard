<!--
  The answers to a choice, lettered from A. The engine draws each answer's
  square and letter and moves them. The browser draws the answer's text, which
  it wraps and screen readers read, in a button anchored to the answer's slot so
  it follows the engine node. The whole row takes the tap, so a tap on the text
  and a tap on the square are the same.

  A choice screen mounts a fresh stage, so the rows are built once.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { domAnchor, easings, ignoreAbort, type Engine } from 'stargazer'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import type { ChoiceOption } from '../story/types'
  import { AnswerRow } from './answerRow'
  import type { Box } from './layout'
  import { MOTION } from './motion'
  import { rowTops } from './rowLayout'

  interface Props {
    engine: Engine
    /** The region the rows are built in, whose anchor is the layout's origin. */
    region: UiRegion
    /** The column the answers fill, in the layout's coordinates. */
    box: Box
    options: readonly ChoiceOption[]
    /** The answer just picked, whose label shows as chosen. */
    picked: string | null
    disabled: boolean
    ariaLabel: (letter: string, label: string) => string
    /** The font size of the answers' text, in design pixels. */
    fontSize: number
    /** The least height of an answer, so it is big enough to tap. */
    minHeight: number
    onPick: (optionId: string) => void
    /** Hands the rows to whoever animates them, once they exist. */
    onRows: (rows: readonly AnswerRow[]) => void
  }
  const {
    engine,
    region,
    box,
    options,
    picked,
    disabled,
    ariaLabel,
    fontSize,
    minHeight,
    onPick,
    onRows,
  }: Props = $props()

  const letterOf = (i: number): string => String.fromCharCode(65 + i)

  // The options are fixed for a stage's life, since a new screen mounts a new one.
  /* svelte-ignore state_referenced_locally */
  const rows = options.map((_, i) => new AnswerRow(letterOf(i)))
  // They arrive when the director brings them in, so they start out of sight.
  for (const row of rows) {
    row.pose.alpha = 0
    row.pose.labelAlpha = 0
    row.apply()
  }
  /* svelte-ignore state_referenced_locally */
  for (const row of rows) row.attachTo(region.anchor)
  /* svelte-ignore state_referenced_locally */
  onRows(rows)

  // The browser measures each label, and the stack follows what it needs.
  /* svelte-ignore state_referenced_locally */
  let heights = $state(options.map(() => 0))
  const tops = $derived(rowTops(heights, box))
  $effect(() => {
    rows.forEach((row, i) => row.place(box.x, tops[i]!))
  })

  /** A tap sinks the square a little, and letting go lifts it. */
  function press(row: AnswerRow, down: boolean): void {
    engine
      .tween(
        row.pose,
        { scale: down ? MOTION.pressScale : 1 },
        {
          duration: MOTION.press,
          easing: easings.outCubic,
          key: 'press',
          onUpdate: () => row.apply(),
        },
      )
      .catch(ignoreAbort)
  }

  onDestroy(() => {
    for (const row of rows) row.destroy()
  })
</script>

<ol
  class="answers"
  style:--answer-width="{box.width}px"
  style:--answer-size="{fontSize}px"
  style:--answer-min-height="{minHeight}px"
>
  {#each options as option, i (option.id)}
    <li>
      <button
        class="answer"
        class:answer--picked={picked === option.id}
        aria-label={ariaLabel(letterOf(i), option.label)}
        {disabled}
        use:domAnchor={{ engine, node: rows[i]!.slot, syncOpacity: true }}
        bind:clientHeight={heights[i]}
        onpointerdown={() => press(rows[i]!, true)}
        onpointerup={() => press(rows[i]!, false)}
        onpointerleave={() => press(rows[i]!, false)}
        onpointercancel={() => press(rows[i]!, false)}
        onclick={() => onPick(option.id)}
      >
        <span class="answer__label" aria-hidden="true">{option.label}</span>
      </button>
    </li>
  {/each}
</ol>

<style lang="sass">
  @use './type'

  .answers
    margin: 0
    padding: 0
    list-style: none

  // Anchored to the answer's slot, so the top left is the slot. The left
  // padding clears the square, which the engine draws under it. The text starts
  // at the top, so the extra height of a small screen is only tap area.
  .answer
    position: absolute
    inset-block-start: 0
    inset-inline-start: 0
    // A button centers its content, and the text has to start at the top.
    display: flex
    align-items: flex-start
    box-sizing: border-box
    // The anchor clears an inline width, so the column's width is a property.
    width: var(--answer-width)
    min-height: var(--answer-min-height)
    padding: 0 0 0 56px
    border: 0
    background: none
    color: var(--color-text)
    text-align: start
    cursor: pointer
    pointer-events: auto
    user-select: none
    -webkit-user-select: none
    -webkit-tap-highlight-color: transparent

    &:disabled
      cursor: default

  // The text is trimmed to its cap height and baseline, so the label is the
  // block that carries the type and the padding. The top padding keeps the
  // first line's cap height on the middle of the 56px square, whatever the size.
  .answer__label
    @include type.option
    font-size: var(--answer-size, 40px)
    display: block
    flex: 1
    padding: calc(28px - 0.35em) 24px 24px

  .answer--picked
    color: var(--color-accent)
</style>
