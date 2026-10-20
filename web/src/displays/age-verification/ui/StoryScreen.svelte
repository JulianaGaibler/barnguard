<!--
  The story itself: the progress row, the current screen's text on the left,
  its answers or illustration on the right, and the buttons along the bottom.
  Laid out in design pixels against the region's visible area, by `layoutFor`.

  The screen owns the run while it's showing. A `StoryDirector` plays every
  move between screens: the markup only reads the numbers it animates, and the
  progress row, the answers' squares and the picture are engine nodes.
-->
<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { domAnchor, type Engine } from '@src/stargazer'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { Run } from '../story/run'
  import { illustrationOf } from '../story/types'
  import type { IllustrationLayer } from './IllustrationLayer'
  import { inWorld, layoutFor } from './layout'
  import type { AnswerRow } from './answerRow'
  import ChoiceStage from './ChoiceStage.svelte'
  import NavBar from './NavBar.svelte'
  import { MOTION, slideOffset } from './motion'
  import {
    StoryDirector,
    type Backdrop,
    type DirectorMotion,
  } from './storyDirector'
  import { MarkNode, TrailView } from './trailView'

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** Draws the illustration of the screen showing, in the right column. */
    illustrations: IllustrationLayer
    /** The background, which moves as the story does. */
    backdrop: Backdrop | null
    /** Where a run begins. Each entrance starts a fresh run from here. */
    start: Run
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** Leave the story for the splash screen. */
    onHome: () => void
  }
  const {
    engine,
    region,
    illustrations,
    backdrop,
    start,
    active,
    onHome,
  }: Props = $props()

  const layout = $derived(layoutFor(region.rect.width, region.rect.height))
  // The picture goes in the right column, wherever the window puts it.
  $effect(() => {
    illustrations.place(inWorld(layout.right, region.rect))
  })

  // The progress row is drawn by the engine, on the region's anchor so that its
  // coordinates are the layout's.
  /* svelte-ignore state_referenced_locally */
  const trail = new TrailView(engine)
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(trail)
  // The moment's big star is the same mark as in the progress row, twice the
  // size. Its place comes from the text column, which the browser lays out.
  const star = new MarkNode('moment', 1)
  star.visible = false
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(star)
  let starSlot = $state<HTMLElement | null>(null)
  /** Where the star's top left goes, in the layout's coordinates. */
  let starAt = $state({ x: 0, y: 0 })
  /** The answers of the choice showing, for the director to animate. */
  let rows: readonly AnswerRow[] = []

  // Each entrance resets the run to `start`, in the effect below.
  /* svelte-ignore state_referenced_locally */
  let run = $state.raw<Run>(start)
  let picked = $state<string | null>(null)
  /** True while a screen change runs, so a second tap can't skip a screen. */
  let busy = $state(false)

  /** How far each part of the screen is in, which the director animates. */
  const motion: DirectorMotion = $state({
    text: 0,
    side: 0,
    nav: 0,
    trail: 0,
    sign: 1,
  })

  /* svelte-ignore state_referenced_locally */
  const director = new StoryDirector({
    engine,
    motion,
    trail,
    rows: () => rows,
    trailOrigin: () => ({ x: layout.rowX, y: layout.trailY }),
    rowWidth: () => layout.rowWidth,
    setRun: async (next) => {
      run = next
      // The answers of a new choice are built when the markup catches up.
      await tick()
    },
    setPicked: (id) => (picked = id),
    showPicture: (next) => illustrations.show(illustrationOf(next.current)),
    movePicture: (offsetX, alpha) => illustrations.move(offsetX, alpha),
    backdrop,
  })

  const node = $derived(run.current)
  const paragraphs = $derived(run.text())

  /** Runs one transition, and keeps taps from starting another meanwhile. */
  async function transition(play: () => Promise<void>): Promise<void> {
    if (busy || !active) return
    busy = true
    try {
      await play()
    } finally {
      busy = false
    }
  }

  $effect(() => {
    if (active) {
      untrack(() => {
        picked = null
        busy = true
        void director.enter(start).finally(() => (busy = false))
      })
    } else {
      untrack(() => {
        void director.exit()
      })
    }
  })

  // The progress row is placed by the layout and slides down as the screen comes in.
  $effect(() => {
    const v = motion.trail
    trail.transform.alpha = v
    trail.transform.x = layout.rowX
    trail.transform.y = layout.trailY - (1 - v) * MOTION.trailDistance
  })

  // One mark per screen shown. Resizing the window only refits the row, and
  // the first showing and a new run are built without motion.
  let trailShown = false
  $effect(() => {
    trail.sync(run.progress(), layout.rowWidth, { animate: trailShown })
    trailShown = true
  })

  // The browser lays out the text column, so the star waits for it and then
  // reads where its placeholder landed.
  $effect(() => {
    void node
    void paragraphs
    void layout
    const slot = starSlot
    if (!slot) return
    void tick().then(() => {
      starAt = {
        x: layout.content.x + slot.offsetLeft,
        y: layout.content.y + slot.offsetTop,
      }
    })
  })

  // The star comes in with the text: it slides, grows and turns into place.
  const STAR_SIZE = 72
  $effect(() => {
    const lead = node.kind === 'moment'
    star.visible = lead
    if (!lead) return
    const v = motion.text
    const grown = STAR_SIZE / 36
    star.transform.x =
      starAt.x +
      STAR_SIZE / 2 +
      slideOffset(motion.sign, v, MOTION.slideDistance)
    star.transform.y = starAt.y + STAR_SIZE / 2
    star.transform.alpha = v
    star.transform.scaleX = star.transform.scaleY = grown * (0.4 + 0.6 * v)
    star.transform.rotation = (1 - v) * -0.9 * motion.sign
  })

  onDestroy(() => {
    director.destroy()
    trail.destroy()
    star.destroy()
  })

  function pick(optionId: string): void {
    if (node.kind !== 'choice') return
    const index = node.options.findIndex((o) => o.id === optionId)
    void transition(() =>
      director.forward(run.choose(optionId), { index, id: optionId }),
    )
  }

  function back(): void {
    if (run.atStart) onHome()
    else void transition(() => director.back(run.back()))
  }

  function forward(): void {
    void transition(() => director.forward(run.continue(), null))
  }

  /** The text column moves as one unit, the title and paragraphs together. */
  const textStyle = $derived(
    `opacity: ${motion.text}; transform: translateX(${slideOffset(motion.sign, motion.text, MOTION.slideDistance)}px)`,
  )

  const navStyle = $derived(
    `opacity: ${motion.nav}; transform: translateX(${slideOffset(motion.sign, motion.nav, MOTION.navDistance)}px)`,
  )

  const hidden = $derived(
    motion.text < 0.001 &&
      motion.side < 0.001 &&
      motion.nav < 0.001 &&
      motion.trail < 0.001,
  )
</script>

<section
  class="story"
  class:story--hidden={hidden}
  aria-hidden={!active}
  use:domAnchor={{
    engine,
    node: region.anchor,
    size: { width: region.rect.width, height: region.rect.height },
  }}
  style="--row-x: {layout.rowX}px; --row-width: {layout.rowWidth}px; --content-y: {layout
    .content.y}px; --content-height: {layout.content
    .height}px; --nav-y: {layout.navY}px"
>
  <!-- The engine draws the progress row. This is its name for screen readers. -->
  <span
    class="story__trail-label"
    role="img"
    aria-label={$t.story.progressLabel(run.progress().length)}
  ></span>

  <div class="story__content">
    <div class="story__text" class:story__text--moment={node.kind === 'moment'}>
      {#if node.kind === 'moment'}
        <span class="story__moment-slot" bind:this={starSlot} aria-hidden="true"
        ></span>
      {/if}
      {#if node.kind === 'ending' && node.title}
        <h1 class="story__title" style={textStyle}>
          {node.title}
        </h1>
      {/if}
      {#each paragraphs as paragraph, i (i)}
        <p class="story__paragraph" style={textStyle}>
          {paragraph}
        </p>
      {/each}
    </div>

    <div class="story__side">
      {#if node.kind !== 'choice' && node.illustration}
        <!-- The engine draws the picture. This holds its place and its name. -->
        <div
          class="story__illustration"
          role="img"
          aria-label={node.illustration.alt}
        ></div>
      {/if}
    </div>
  </div>

  <div class="story__nav" style={navStyle}>
    <NavBar
      disabled={busy || !active}
      back={{ label: $t.story.back, onPress: back }}
      forward={node.kind === 'scene' || node.kind === 'moment'
        ? { label: $t.story.continue, onPress: forward }
        : node.kind === 'ending'
          ? { label: $t.story.startOver, onPress: onHome }
          : undefined}
      home={node.kind === 'ending'
        ? undefined
        : { label: $t.story.home, onPress: onHome }}
    />
  </div>
</section>

<!-- A sibling of the section, not inside it: the answers' text anchors to the
     engine's rows, and an anchored element cannot sit in another one. -->
{#if node.kind === 'choice'}
  {#key run.currentId}
    <ChoiceStage
      {engine}
      {region}
      box={layout.right}
      options={node.options}
      {picked}
      disabled={busy || !active}
      ariaLabel={$t.story.optionLabel}
      onPick={pick}
      onRows={(next) => (rows = next)}
    />
  {/key}
{/if}

<style lang="sass">
  @use './type'

  // The engine sizes and places the section on the canvas.
  .story
    position: absolute
    inset-block-start: 0
    inset-inline-start: 0
    color: var(--color-text)
    user-select: none
    -webkit-user-select: none

  .story--hidden
    visibility: hidden

  // The row and the buttons are placed by the layout, which sets these
  // properties on the section.
  .story__trail-label
    position: absolute
    width: 1px
    height: 1px
    overflow: hidden
    clip-path: inset(50%)

  .story__content
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--content-y)
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 128px
    width: var(--row-width)
    height: var(--content-height)

  .story__text,
  .story__side
    display: flex
    flex-direction: column
    justify-content: center
    min-width: 0

  .story__text
    gap: 52.8px

  .story__paragraph
    @include type.body
    margin: 0

  // One empty line between paragraphs, as in the design. The text boxes are
  // trimmed to cap height and baseline, so the gap is two lines less a cap.
  .story__paragraph + .story__paragraph
    margin-block-start: calc(2.4em - 1cap - 52.8px)

  .story__title
    @include type.letter
    margin: 0

  // Holds the star's place in the column. The engine draws the star.
  .story__moment-slot
    display: block
    flex: none
    width: 72px
    height: 72px

  .story__illustration
    width: 100%
    height: 100%

  .story__nav
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--nav-y)
    width: var(--row-width)
</style>
