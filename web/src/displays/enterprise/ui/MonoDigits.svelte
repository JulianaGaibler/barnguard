<script lang="ts">
  /**
   * A readout whose digits each sit in a fixed-width cell, so a number that
   * changes every frame never shifts the text beside it. Non-digit characters
   * (a colon in a timer) keep their natural width.
   */
  import {
    DIGIT_CELL_EM,
    isDigit,
    type MonoChar,
    type MonoFamily,
  } from '@src/displays/enterprise/format/splitScore'

  interface Props {
    chars: readonly MonoChar[]
    family: MonoFamily
  }
  let { chars, family }: Props = $props()

  const label = $derived(chars.map((c) => c.char).join(''))
</script>

<span
  class="mono"
  role="img"
  aria-label={label}
  style:--cell="{DIGIT_CELL_EM[family]}em"
>
  {#each chars as c, i (i)}
    <span
      class="mono__char"
      class:mono__char--digit={isDigit(c.char)}
      class:mono__char--dim={c.dim}
      aria-hidden="true">{c.char}</span
    >
  {/each}
</span>

<style lang="sass">
  .mono
    display: inline-flex
    white-space: nowrap

  .mono__char--digit
    display: inline-block
    width: var(--cell)
    text-align: center

  .mono__char--dim
    opacity: 0.25
</style>
