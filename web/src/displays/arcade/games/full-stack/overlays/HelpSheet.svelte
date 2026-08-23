<!--
  One card said at length, beside the card itself.

  The board dims and the card floats out on the canvas, which is why this has no
  scrim of its own and why it sits in the space left beside the card rather than
  centred. Prose is the reason it is HTML: the card faces have to fit rules text
  into a band thirty pixels tall, and this does not.
-->
<script lang="ts">
  import { fade } from 'svelte/transition'
  import Surface from '@src/core/ui/Surface.svelte'
  import IconButton from '@src/core/ui/IconButton.svelte'
  import closeIcon from '@src/assets/icons/close-16.svg?raw'
  import type { Rect } from '@src/stargazer'
  import { FS_STRINGS as t } from '../strings'
  import { CONCEPTS, explainCard } from '../game/rules/help'
  import type { Card } from '../game'
  import GlyphSpans from './GlyphSpans.svelte'

  interface Props {
    card: Card
    /** The space beside the focused card, in coordinates local to the overlay. */
    sheet: Rect
    onClose: () => void
  }
  const { card, sheet, onClose }: Props = $props()

  const help = $derived(explainCard(card))

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="fs-help"
  transition:fade={{ duration: 140 }}
  style:left="{sheet.x}px"
  style:top="{sheet.y}px"
  style:width="{sheet.width}px"
  style:height="{sheet.height}px"
>
  <Surface tone="light">
    <!--
      The whole sheet scrolls, header included, so the name travels with the
      prose under it. The header pins itself to the top on the way past.
    -->
    <div class="fs-help__scroll">
      <header class="fs-help__head">
        <div class="fs-help__title">
          <h2 class="fs-help__name">{card.name}</h2>
          <p class="fs-help__sub"><GlyphSpans spans={help.subtitle} /></p>
        </div>
        <div class="fs-help__dismiss">
          <IconButton label={t.close} tone="surface" onclick={onClose}>
            <span class="fs-help__close">{@html closeIcon}</span>
          </IconButton>
        </div>
      </header>

      <div class="fs-help__body">
        {#if help.onHire.length > 0}
          <section>
            <h3 class="fs-help__heading">{t.whenHired}</h3>
            {#each help.onHire as block, i (i)}
              {#if block.kind === 'choice'}
                <div class="fs-help__choice">
                  {#each block.options as option, j (j)}
                    {#if j > 0}<span class="fs-help__or">{t.or}</span>{/if}
                    <p class="fs-help__branch">
                      <GlyphSpans spans={option} />
                    </p>
                  {/each}
                </div>
              {:else}
                <p class="fs-help__line"><GlyphSpans spans={block.spans} /></p>
              {/if}
            {/each}
          </section>
        {/if}

        <section>
          <h3 class="fs-help__heading">{t.whenScored}</h3>
          <p class="fs-help__line"><GlyphSpans spans={help.review} /></p>
        </section>

        {#each help.concepts as id (id)}
          <section class="fs-help__note">
            <h3 class="fs-help__heading">{CONCEPTS[id].title}</h3>
            {#each CONCEPTS[id].body as para, i (i)}
              <p class="fs-help__line"><GlyphSpans spans={para} /></p>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </Surface>
</div>

<style lang="sass">
  .fs-help
    position: absolute
    display: flex
    pointer-events: auto

  // `Surface` is a flex row, so without this the sheet collapses to the width
  // of its longest line and the header has nothing to push the close button to.
  .fs-help :global(.surface)
    flex: 1
    min-width: 0
    display: flex

  .fs-help__scroll
    flex: 1
    min-width: 0
    overflow-y: auto

  .fs-help__head
    position: sticky
    top: 0
    z-index: 1
    display: flex
    align-items: flex-start
    justify-content: space-between
    gap: var(--space-16)
    // Its own ground, so the prose scrolls under it rather than through it.
    background: var(--color-surface-card)
    padding: var(--space-24) var(--space-24) var(--space-12)
    border-bottom: 1px solid var(--color-border)

  .fs-help__title
    min-width: 0

  .fs-help__name
    @include tint.type-class(card-title)
    color: var(--color-title)
    margin: 0

  .fs-help__sub
    @include tint.type-class(body)
    color: var(--color-text-secondary)
    margin: var(--space-4) 0 0

  // `IconButton` is round and fixed, so it must not take a share of the row.
  .fs-help__dismiss
    flex: none

  .fs-help__close
    display: inline-flex

    :global(svg)
      display: block
      width: 20px
      height: 20px
      fill: currentColor

  .fs-help__body
    display: flex
    flex-direction: column
    gap: var(--space-16)
    padding: var(--space-16) var(--space-24) var(--space-24)

  .fs-help__heading
    @include tint.type-class(ui-small-bold)
    color: var(--color-accent)
    margin: 0 0 var(--space-4)
    text-transform: uppercase
    letter-spacing: 0.06em

  // The notes explain the game rather than the card, so a rule sets them off
  // from the two sections that are about this card.
  .fs-help__note
    border-top: 1px solid var(--color-border)
    padding-top: var(--space-12)

  // The branches of a choice are alternatives, so each gets its own box and the
  // word between them carries the whole weight of the decision.
  .fs-help__choice
    display: flex
    align-items: center
    gap: var(--space-8)

  .fs-help__branch
    flex: 1
    margin: 0
    padding: var(--space-8) var(--space-12)
    border: 1px solid var(--color-border)
    border-radius: var(--radius-card)
    @include tint.type-class(body)
    line-height: 1.4
    color: var(--color-text)

  .fs-help__or
    @include tint.type-class(ui-small-bold)
    color: var(--color-text-secondary)
    text-transform: uppercase

  // Roomier than the type scale sets, because the inline marks stand taller
  // than the words and would otherwise crowd the line above.
  .fs-help__line
    @include tint.type-class(body)
    line-height: 1.4
    color: var(--color-text)
    margin: 0 0 var(--space-8)

    &:last-child
      margin-bottom: 0
</style>
