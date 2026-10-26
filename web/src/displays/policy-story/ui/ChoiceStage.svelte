<!--
  The answers to a choice. The engine draws each answer's small square and moves
  it. The browser draws the answer's text, which
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
  import { AnswerRow, type RowColors } from './answerRow'
  import type { Box } from './layout'
  import { MOTION } from './motion'
  import {
    ANSWER_COLUMN_GAP,
    centerEach,
    centerRow,
    columnLayout,
    columnTops,
    rowTops,
  } from './rowLayout'

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
    ariaLabel: (label: string) => string
    /** The least height of an answer, so it is big enough to tap. */
    minHeight: number
    /** The colors of the squares, from the mood the screen is in. */
    colors: RowColors
    /** The font size of the answers' text, in design pixels. */
    fontSize: number
    /** True to stand the answers side by side across the box. */
    horizontal: boolean
    /** True to set the answers as plain centered text, with no square. */
    centered: boolean
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
    minHeight,
    colors,
    fontSize,
    horizontal,
    centered,
    onPick,
    onRows,
  }: Props = $props()

  // The options are fixed for a stage's life, since a new screen mounts a new one.
  /* svelte-ignore state_referenced_locally */
  const rows = options.map(() => new AnswerRow(colors))
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
  // Centered, each is as wide as its text, up to an equal share of the box when
  // side by side, with a fixed gap between them.
  /* svelte-ignore state_referenced_locally */
  let widths = $state(options.map(() => 0))
  const columns = $derived(columnLayout(options.length, box))
  const xs = $derived(
    horizontal
      ? centerRow(widths, box, ANSWER_COLUMN_GAP)
      : centerEach(widths, box),
  )
  const tops = $derived(
    horizontal ? columnTops(heights, box) : rowTops(heights, box),
  )
  $effect(() => {
    rows.forEach((row, i) => {
      row.plain = centered
      row.place(centered ? xs[i]! : box.x, tops[i]!)
    })
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
  class:answers--plain={centered}
  style:--answer-width="{horizontal ? columns.width : box.width}px"
  style:--answer-min-height="{minHeight}px"
  style:--answer-size="{fontSize}px"
>
  {#each options as option, i (option.id)}
    <li>
      <button
        class="answer"
        class:answer--picked={picked === option.id}
        class:answer--thought={option.style === 'thought'}
        aria-label={ariaLabel(option.label)}
        {disabled}
        use:domAnchor={{ engine, node: rows[i]!.slot, syncOpacity: true }}
        bind:clientHeight={heights[i]}
        bind:clientWidth={widths[i]}
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
  // block that carries the type and the padding. The top padding puts the cap
  // height of the first line on the middle of the 56px square.
  .answer__label
    @include type.option
    // The size follows the window. The top padding keeps the first line's cap
    // height on the middle of the 56px square, whatever the size.
    font-size: var(--answer-size, 36px)
    display: block
    flex: 1
    padding: calc(28px - 0.35em) 24px 24px

  .answer--picked
    color: var(--color-accent)

  // Centered an answer is only its text, in the action color, as wide as the
  // text needs, and underlined while it is pointed at.
  .answers--plain .answer
    width: max-content
    max-width: var(--answer-width)
    align-items: center
    padding: 0
    text-align: center

  .answers--plain .answer__label
    padding: 0.4em 0.1em
    color: var(--color-accent)

  .answers--plain .answer:hover .answer__label,
  .answers--plain .answer:focus-visible .answer__label,
  .answers--plain .answer:active .answer__label
    text-decoration: underline
    text-decoration-thickness: 0.07em
    text-underline-offset: 0.22em

  .answer--thought .answer__label
    font-style: italic
</style>
