<!--
  The result card, shared by all three modes.
  
  Flood It has no leaderboard, so this is its own card rather than the arcade's
  `GameOverPanel`: there is no score to submit and no name to enter, and the
  panel's whole reason to exist is that flow. The two actions match its wording
  so the gesture is the same one players learn elsewhere in the arcade.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import type { Snippet } from 'svelte'
  import Button from '@src/core/ui/Button.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import { t as arcadeT } from '@src/displays/arcade/i18n'

  interface Props {
    title: string
    /** Accent for the title, so a winner reads in their own color. */
    titleColor?: string
    body?: string
    onPlayAgain: () => void
    onMenu: () => void
    /** Mode-specific detail between the title and the actions. */
    detail?: Snippet
  }
  const { title, titleColor, body, onPlayAgain, onMenu, detail }: Props =
    $props()
</script>

<div class="result" transition:fade={{ duration: 150 }}>
  <div class="result__card" transition:scale={{ start: 0.92, duration: 200 }}>
    <Surface tone="light">
      <div class="result__body">
        <h2 class="result__title" style:color={titleColor}>{title}</h2>
        {#if detail}{@render detail()}{/if}
        {#if body}<p class="result__note">{body}</p>{/if}
        <div class="result__actions">
          <Button variant="primary" onclick={onPlayAgain}
            >{$arcadeT.arcade.leaderboard.playAgain}</Button
          >
          <Button variant="outline" onclick={onMenu}
            >{$arcadeT.arcade.leaderboard.menu}</Button
          >
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .result
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    background: var(--color-scrim)
    pointer-events: auto

  .result__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-24)
    padding-block: var(--space-48)
    padding-inline: var(--space-64)
    text-align: center

  .result__title
    @include tint.type-class(headline)
    margin: 0
    // The shared type scale sets no line-height, so a 2.5rem heading takes the
    // browser's leading and the column's gaps stop reading as the gaps they are.
    line-height: 1.15

  .result__note
    @include tint.type-class(body)
    margin: 0
    // Measured in characters rather than rem, so the line length holds at any
    // root size or UI scale. Balanced wrapping keeps a two-line note even
    // instead of dropping a single word onto its own line.
    max-width: 34ch
    text-wrap: balance
    line-height: 1.45
    color: var(--color-text-secondary)

  .result__actions
    display: flex
    gap: var(--space-16)
</style>
