<!--
  The story itself: the progress row, the current screen's text on the left,
  its answers or illustration on the right, and the buttons along the bottom.
  Laid out in design pixels against the region's visible area, by `layoutFor`.

  The screen owns the run while it's showing. Moving on hides the text and the
  right column, swaps the screen, and brings them back, while the progress row
  and the buttons stay put.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { ignoreAbort, type Engine } from '@src/stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { Run } from '../story/run'
  import { illustrationOf } from '../story/types'
  import type { IllustrationLayer } from './IllustrationLayer'
  import { inWorld, layoutFor } from './layout'
  import ChoiceList from './ChoiceList.svelte'
  import NavBar from './NavBar.svelte'
  import ProgressTrail from './ProgressTrail.svelte'

  /** How long a picked answer shows before the screen moves on. */
  const PICK_HOLD_SEC = 0.3

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** Draws the illustration of the screen showing, in the right column. */
    illustrations: IllustrationLayer
    /** Where a run begins. Each entrance starts a fresh run from here. */
    start: Run
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** Leave the story for the splash screen. */
    onHome: () => void
  }
  const { engine, region, illustrations, start, active, onHome }: Props =
    $props()

  const layout = $derived(layoutFor(region.rect.width, region.rect.height))
  // The picture goes in the right column, wherever the window puts it.
  $effect(() => {
    illustrations.place(inWorld(layout.right, region.rect))
  })

  // The engine is fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  const frame = new Reveal(engine, 2)
  /* svelte-ignore state_referenced_locally */
  const content = new Reveal(engine, 2)

  // Each entrance resets the run to `start`, in the effect below.
  /* svelte-ignore state_referenced_locally */
  let run = $state.raw<Run>(start)
  let picked = $state<string | null>(null)
  /** True while a screen change runs, so a second tap can't skip a screen. */
  let busy = $state(false)

  const node = $derived(run.current)
  const paragraphs = $derived(run.text())

  $effect(() => {
    if (active) {
      run = start
      picked = null
      busy = false
      frame.show()
      void illustrations.show(illustrationOf(start.current)).then(() => {
        if (active) content.show()
      })
    } else {
      void frame.hide()
      void content.hide()
    }
  })

  // The illustration fades with the right column.
  $effect(() => {
    illustrations.alpha = content.items[1]!.v
  })

  onDestroy(() => {
    frame.destroy()
    content.destroy()
  })

  /** Hide the content, move to `next`, and bring the content back. */
  async function moveTo(next: () => Run): Promise<void> {
    if (busy || !active) return
    busy = true
    try {
      await content.hide()
      if (!active) return
      run = next()
      picked = null
      // The art is drawn before the content comes back, so it fades in whole.
      await illustrations.show(illustrationOf(run.current))
      if (!active) return
      content.show()
    } finally {
      busy = false
    }
  }

  async function pick(optionId: string): Promise<void> {
    if (busy || !active) return
    picked = optionId
    busy = true
    await engine.wait(PICK_HOLD_SEC).catch(ignoreAbort)
    busy = false
    void moveTo(() => run.choose(optionId))
  }

  function back(): void {
    if (run.atStart) onHome()
    else void moveTo(() => run.back())
  }

  const part = (reveal: Reveal, i: number): string =>
    `opacity: ${reveal.items[i]!.v}; transform: translateY(${(1 - reveal.items[i]!.v) * 48}px)`
</script>

<section
  class="story"
  class:story--hidden={!frame.visible}
  aria-hidden={!active}
  style="--row-x: {layout.rowX}px; --row-width: {layout.rowWidth}px; --trail-y: {layout.trailY}px; --content-y: {layout
    .content.y}px; --content-height: {layout.content
    .height}px; --nav-y: {layout.navY}px"
>
  <div class="story__trail" style={part(frame, 0)}>
    <ProgressTrail
      marks={run.progress()}
      maxWidth={layout.rowWidth}
      label={$t.story.progressLabel(run.history.length)}
    />
  </div>

  <div class="story__content">
    <div
      class="story__text"
      class:story__text--moment={node.kind === 'moment'}
      style={part(content, 0)}
    >
      {#if node.kind === 'moment'}
        <svg class="story__moment-mark" viewBox="0 0 36 36" aria-hidden="true">
          <path
            d="M18 0L24.364 11.636L36 18L24.364 24.364L18 36L11.636 24.364L0 18L11.636 11.636Z"
          />
        </svg>
      {/if}
      {#if node.kind === 'ending' && node.title}
        <h1 class="story__title">{node.title}</h1>
      {/if}
      {#each paragraphs as paragraph, i (i)}
        <p class="story__paragraph">{paragraph}</p>
      {/each}
    </div>

    <div class="story__side" style={part(content, 1)}>
      {#if node.kind === 'choice'}
        <ChoiceList
          options={node.options}
          {picked}
          disabled={busy || !active}
          ariaLabel={$t.story.optionLabel}
          onPick={(id) => void pick(id)}
        />
      {:else if node.illustration}
        <!-- The engine draws the picture. This holds its place and its name. -->
        <div
          class="story__illustration"
          role="img"
          aria-label={node.illustration.alt}
        ></div>
      {/if}
    </div>
  </div>

  <div class="story__nav" style={part(frame, 1)}>
    <NavBar
      disabled={busy || !active}
      back={{ label: $t.story.back, onPress: back }}
      forward={node.kind === 'scene' || node.kind === 'moment'
        ? {
            label: $t.story.continue,
            onPress: () => void moveTo(() => run.continue()),
          }
        : node.kind === 'ending'
          ? { label: $t.story.startOver, onPress: onHome }
          : undefined}
      home={node.kind === 'ending'
        ? undefined
        : { label: $t.story.home, onPress: onHome }}
    />
  </div>
</section>

<style lang="sass">
  @use './type'

  .story
    position: absolute
    inset: 0
    color: var(--color-text)

  .story--hidden
    visibility: hidden

  // The row, the progress row and the buttons are placed by the layout, which
  // sets these properties on the section.
  .story__trail
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--trail-y)

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

  .story__moment-mark
    width: 72px
    height: 72px
    fill: var(--color-accent)

  .story__illustration
    width: 100%
    height: 100%

  .story__nav
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--nav-y)
    width: var(--row-width)
</style>
