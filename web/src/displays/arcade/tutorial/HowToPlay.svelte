<!--
  Reusable "How to play" modal: a horizontally-scrolling, center-snapping card
  carousel tuned for big touch screens. A single arcade-owned demo stage
  (`demoStage`) renders whichever card is centered — its fixed canvas slots in
  over the center of the track while the cards scroll beneath it.

  The centered card is found via an IntersectionObserver (max ratio); the scene
  swap is committed on scroll settle (debounced) so flinging past several cards
  doesn't thrash build/destroy. The canvas dims only while the centered card
  differs from the one that's built — scrolling within (or back to) the current
  card leaves the demo untouched.

  Screen-space (not camera-anchored): mounted by each game as a sibling of its
  `domAnchor` overlay wrapper so the demo canvas renders at true resolution.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import Overlay from '@src/core/ui/Overlay.svelte'
  import Surface from '@src/core/ui/Surface.svelte'
  import IconButton from '@src/core/ui/IconButton.svelte'
  import { t } from '../i18n'
  import { tutorialOpen } from '../uiState'
  import TutorialCard from './TutorialCard.svelte'
  import type { DemoStageController, TutorialSpec } from './types'
  import closeIconRaw from '@src/assets/icons/close-16.svg?raw'
  import chevronLeftRaw from '@src/assets/icons/chevron-left-24.svg?raw'
  import chevronRightRaw from '@src/assets/icons/chevron-right-24.svg?raw'

  interface Props {
    cards: TutorialSpec
    demoStage: DemoStageController
    onClose: () => void
  }
  const { cards, demoStage, onClose }: Props = $props()

  let trackEl = $state<HTMLDivElement>()
  let stageSlotEl = $state<HTMLDivElement>()
  let slotEls = $state<HTMLDivElement[]>([])
  /** Card the observer reports as centered (drives dots + which demo to build). */
  let centeredIndex = $state(0)
  /** Card whose demo is currently built; -1 until the first commit. */
  let committedIndex = $state(-1)
  /** Hide the canvas only while it's showing a card other than the centered one. */
  const dimmed = $derived(centeredIndex !== committedIndex)
  /** Latest intersection ratio per card (non-reactive scratch, filled on mount). */
  const ratios: number[] = []
  let io: IntersectionObserver | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  /** Debounce window after the last scroll event before committing a swap. */
  const SETTLE_MS = 140

  function recomputeCentered(): void {
    let best = 0
    let bestRatio = -1
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] > bestRatio) {
        bestRatio = ratios[i]
        best = i
      }
    }
    centeredIndex = best
  }

  function commit(): void {
    if (committedIndex === centeredIndex) return
    committedIndex = centeredIndex
    demoStage.setDemo(cards[centeredIndex].build)
  }

  function onScroll(): void {
    // Rebuild only when the scroll settles on a different card; a nudge that
    // lands back on the current card is a no-op (see `commit`'s guard).
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      commit()
    }, SETTLE_MS)
  }

  function goTo(index: number): void {
    const clamped = Math.max(0, Math.min(cards.length - 1, index))
    slotEls[clamped]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }

  onMount(() => {
    for (let i = 0; i < cards.length; i++) ratios[i] = 0
    if (stageSlotEl) demoStage.reveal(stageSlotEl)
    tutorialOpen.set(true)

    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = slotEls.indexOf(e.target as HTMLDivElement)
          if (idx >= 0) ratios[idx] = e.intersectionRatio
        }
        recomputeCentered()
      },
      { root: trackEl, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const el of slotEls) if (el) io.observe(el)

    // Build the first card once layout has settled (the reveal's resize gives
    // the canvas a real size).
    const raf = requestAnimationFrame(() => {
      centeredIndex = 0
      commit()
    })

    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      io = null
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = null
      demoStage.hide()
      tutorialOpen.set(false)
    }
  })
</script>

<Overlay scrim center onscrimclick={onClose}>
  <div
    class="htp"
    style="--htp-media-w: 30rem; --htp-media-h: 22.5rem; --htp-card-pad: var(--space-24); --htp-text-h: 8rem; --htp-card-w: calc(var(--htp-media-w) + var(--htp-card-pad) * 2)"
  >
    <Surface tone="light" radius="panel">
      <div class="htp__inner">
        <header class="htp__header">
          <h2 class="htp__heading">{$t.arcade.tutorial.title}</h2>
          <IconButton
            label={$t.arcade.tutorial.close}
            tone="surface"
            onclick={onClose}
          >
            <span class="htp__close-icon">{@html closeIconRaw}</span>
          </IconButton>
        </header>

        <div class="htp__carousel">
          <button
            class="htp__nav"
            aria-label={$t.arcade.tutorial.prev}
            disabled={centeredIndex <= 0}
            onclick={() => goTo(centeredIndex - 1)}
          >
            {@html chevronLeftRaw}
          </button>

          <div class="htp__viewport">
            <div
              class="htp__track"
              bind:this={trackEl}
              onscroll={onScroll}
              role="group"
              aria-roledescription="carousel"
            >
              {#each cards as card, i (i)}
                <div class="htp__slot" bind:this={slotEls[i]}>
                  <TutorialCard title={card.title} body={card.body} />
                </div>
              {/each}
            </div>
            <!-- Fixed center slot: the shared demo canvas mounts here, above the
                 track, click-through so swipes reach the cards beneath. -->
            <div
              class="htp__stage"
              class:htp__stage--dim={dimmed}
              bind:this={stageSlotEl}
            ></div>
          </div>

          <button
            class="htp__nav"
            aria-label={$t.arcade.tutorial.next}
            disabled={centeredIndex >= cards.length - 1}
            onclick={() => goTo(centeredIndex + 1)}
          >
            {@html chevronRightRaw}
          </button>
        </div>

        <div class="htp__dots">
          {#each cards as card, i (i)}
            <button
              class="htp__dot"
              class:htp__dot--active={i === centeredIndex}
              aria-label={card.title}
              aria-current={i === centeredIndex}
              onclick={() => goTo(i)}
            ></button>
          {/each}
        </div>
      </div>
    </Surface>
  </div>
</Overlay>

<style lang="sass">
  .htp
    // Sit above the Overlay's full-screen scrim-dismiss button (which is
    // absolutely positioned, so it would otherwise paint over this static
    // content and swallow every click). Positioned + z-index keeps the card UI
    // interactive; only taps outside it reach the dismiss backdrop.
    position: relative
    z-index: 1
    max-width: 92vw
    pointer-events: auto

  .htp__inner
    display: flex
    flex-direction: column
    gap: var(--space-16)
    padding: var(--space-24)

  .htp__header
    display: flex
    align-items: center
    justify-content: space-between
    gap: var(--space-16)

  .htp__heading
    margin: 0
    @include tint.type-class(headline)
    color: var(--color-text)
    margin-block-start: var(--space-12)
    margin-inline-start: var(--space-12)

  .htp__close-icon
    display: inline-flex
    :global(svg)
      width: 20px
      height: 20px
      fill: currentColor
      display: block

  .htp__carousel
    display: flex
    align-items: center
    gap: var(--space-8)

  .htp__nav
    flex-shrink: 0
    display: inline-flex
    align-items: center
    justify-content: center
    width: var(--space-48)
    height: var(--space-48)
    border: none
    border-radius: var(--radius-pill)
    cursor: pointer
    color: var(--color-text)
    background: transparent

    &:disabled
      opacity: 0.25
      cursor: default

    &:not(:disabled):active
      background: var(--color-surface-card)

  .htp__viewport
    position: relative
    // Show the centered card plus peeks of its neighbors.
    width: min(84vw, calc(var(--htp-card-w) * 1.7))
    height: calc(var(--htp-card-pad) * 2 + var(--htp-media-h) + var(--space-16) + var(--htp-text-h))
    // Fade the peeking neighbor cards out toward both edges. The fade spans the
    // peek region (whatever's left of the viewport once the centered card is
    // placed), so the centered card stays fully opaque and its neighbors ramp
    // to transparent at the edges.
    --htp-edge-fade: max(var(--space-24), calc((100% - var(--htp-card-w)) / 2))
    -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--htp-edge-fade), #000 calc(100% - var(--htp-edge-fade)), transparent)
    mask-image: linear-gradient(to right, transparent, #000 var(--htp-edge-fade), #000 calc(100% - var(--htp-edge-fade)), transparent)

  .htp__track
    display: flex
    height: 100%
    gap: var(--space-24)
    overflow-x: auto
    overflow-y: hidden
    scroll-snap-type: x mandatory
    scroll-behavior: smooth
    // Leading/trailing space so the first and last cards can reach center.
    padding-inline: calc((100% - var(--htp-card-w)) / 2)
    scrollbar-width: none

    &::-webkit-scrollbar
      display: none

  .htp__slot
    flex: 0 0 var(--htp-card-w)
    scroll-snap-align: center

  .htp__stage
    position: absolute
    inset-block-start: var(--htp-card-pad)
    inset-inline-start: 50%
    transform: translateX(-50%)
    width: var(--htp-media-w)
    height: var(--htp-media-h)
    pointer-events: none
    opacity: 1
    transition: opacity 0.18s ease

  .htp__stage--dim
    opacity: 0

  .htp__dots
    display: flex
    align-items: center
    justify-content: center
    gap: var(--space-12)

  .htp__dot
    width: 0.75rem
    height: 0.75rem
    padding: 0
    border: none
    border-radius: var(--radius-pill)
    cursor: pointer
    background: var(--color-text)
    opacity: 0.25
    transition: opacity 0.18s ease, transform 0.18s ease

  .htp__dot--active
    opacity: 0.9
    transform: scale(1.25)
</style>
