<!--
  Who a Freeze, a Three More or a spare Extra Life goes to.

  A card is already drawn by the time this opens, so backing out is not a legal
  move and there is no cancel. Each option carries its seat's shape as well as
  its color, because two of the five accents are not separable for everyone.

  Anchored over the buttons with no scrim, because the card this asks about is
  standing in the middle of the table. A centred modal covers the one thing the
  choice is about, and a dimmed table makes it look as though the table has
  stopped rather than that it is waiting. Over the buttons specifically, since
  Hit and Stay are dead while this is open and this is what replaces them.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import Surface from '@src/core/ui/Surface.svelte'
  import Button from '@src/core/ui/Button.svelte'
  import SeatBadge from './SeatBadge.svelte'
  import { MONSTERS_INT_STRINGS as t } from '../strings'
  import { seatName, type TargetPrompt } from '../game'

  interface Props {
    prompt: TargetPrompt
    onPick: (seat: number) => void
  }
  const { prompt, onPick }: Props = $props()

  const heading = $derived(
    prompt.kind === 'freeze'
      ? t.aimFreeze
      : prompt.kind === 'threeMore'
        ? t.aimThreeMore
        : t.giveLife,
  )
</script>

<div class="mi-target" transition:fade={{ duration: 150 }}>
  <div
    class="mi-target__card"
    transition:scale={{ start: 0.94, duration: 180 }}
  >
    <Surface tone="light">
      <div class="mi-target__body">
        <h2 class="mi-target__title">{heading}</h2>
        <p class="mi-target__by">{t.drawnBy(seatName(prompt.seat))}</p>
        <div class="mi-target__seats">
          {#each prompt.eligible as seat (seat)}
            <Button variant="surface" onclick={() => onPick(seat)}>
              <span class="mi-target__seat">
                <SeatBadge {seat} size={28} />
                {seatName(seat)}
                {#if seat === prompt.seat}
                  <span class="mi-target__you">{t.you}</span>
                {/if}
              </span>
            </Button>
          {/each}
        </div>
      </div>
    </Surface>
  </div>
</div>

<style lang="sass">
  .mi-target
    position: absolute
    inset: 0
    display: flex
    align-items: flex-end
    justify-content: center
    padding-bottom: 9%
    // No scrim, and no catcher: the table underneath stays lit and stays live.
    pointer-events: none

  .mi-target__card
    pointer-events: auto

  // `Surface` carries no padding of its own, so every card sets its own.
  .mi-target__body
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding-block: var(--space-32)
    padding-inline: var(--space-48)
    text-align: center

  .mi-target__title
    margin: 0
    @include tint.type-class(headline)

  .mi-target__by
    margin: 0
    @include tint.type-class(ui)
    color: var(--color-text-secondary)

  .mi-target__seats
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: var(--space-12)
    margin-top: var(--space-8)

  .mi-target__seat
    display: inline-flex
    align-items: center
    gap: var(--space-8)

  // Aiming at yourself is a legal and sometimes forced move, so this is a note
  // on the option rather than a warning about it.
  .mi-target__you
    @include tint.type-class(ui-small)
    color: var(--color-text-secondary)
</style>
