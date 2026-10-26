<script lang="ts">
  /**
   * A high score in a pill: a lead on the left (a label on black, a code on
   * black, or a flag) and the score on white beside it, as three digits with
   * the padding zeros dimmed.
   */
  import { splitScore } from '@src/displays/enterprise/format/splitScore'
  import MonoDigits from './MonoDigits.svelte'

  interface Props {
    score: number
    /** Text for the black lead segment, such as "All" or a state code. */
    label?: string
    /** Flag markup for the lead segment, drawn instead of a label. */
    flag?: string
    /** The smaller size used inside a card, four fifths of the full one. */
    compact?: boolean
  }
  let { score, label, flag, compact = false }: Props = $props()
</script>

<span class="pill" class:pill--compact={compact}>
  {#if flag}
    <span class="pill__flag" aria-hidden="true">{@html flag}</span>
  {:else if label}
    <span class="pill__lead">{label}</span>
  {/if}
  <span class="pill__score">
    <MonoDigits chars={splitScore(score)} family="text" />
  </span>
</span>

<style lang="sass">
  .pill
    display: inline-flex
    align-items: stretch
    height: 47px
    border-radius: 999px
    overflow: hidden
    font-family: var(--font-mozilla-text)
    font-weight: 700
    font-size: 24px

  .pill__lead
    display: flex
    align-items: center
    padding: 9px 12px 9px 18px
    background: #000000
    color: #ffffff
    white-space: nowrap

  .pill__flag
    display: block
    width: 69.75px
    height: 46.5px
    align-self: center

    :global(svg)
      display: block
      width: 100%
      height: 100%

  .pill__score
    display: flex
    align-items: center
    padding: 9px 18px 9px 12px
    background: #ffffff
    color: #000000

  // Four fifths of the full size, every measure scaled alike.
  .pill--compact
    height: 37.4px
    font-size: 19.2px

    .pill__lead
      padding: 7.2px 9.6px 7.2px 14.4px

    .pill__flag
      width: 55.8px
      height: 37.2px

    .pill__score
      padding: 7.2px 14.4px 7.2px 9.6px
</style>
