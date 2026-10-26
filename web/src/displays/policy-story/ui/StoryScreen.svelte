<!--
  The story itself: the progress row, the current screen's text, its answers or
  illustration, and the button along the bottom. The text is on the left and the
  rest on the right, or in one column on a portrait screen. Laid out in design
  pixels against the region's visible area, by `layoutIn`.

  The layout reaches the markup through `style:` directives. A `style` attribute
  would erase the inline transform and size that `domAnchor` writes whenever it
  changed.

  The screen owns the run while it's showing. A `StoryDirector` plays every
  move between screens: the markup only reads the numbers it animates, and the
  progress row, the answers' squares and the picture are engine nodes.
-->
<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { domAnchor, type Engine } from 'stargazer'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import { Run } from '../story/run'
  import { illustrationOf } from '../story/types'
  import type { IllustrationLayer } from './IllustrationLayer'
  import { bodyCssPx, contentHeight, fitText, textRange } from './fitText'
  import { inWorld, layoutIn, tapHeight, type ScreenKind } from './layout'
  import { pieceAlpha, stagingFor, type StagingSpec } from './staging'
  import { TILE_SIZE } from './rowLayout'
  import type { AnswerRow } from './answerRow'
  import ChoiceStage from './ChoiceStage.svelte'
  import NavBar from './NavBar.svelte'
  import { moodNamed } from './moods'
  import { MOTION, slideOffset } from './motion'
  import {
    StoryDirector,
    type Backdrop,
    type Curtain,
    type DirectorMotion,
  } from './storyDirector'
  import { TrailView } from './trailView'

  /** An answer's text is this share of the body text. */
  const ANSWER_SHARE = 0.92

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** Draws the illustration of the screen showing, in its media box. */
    illustrations: IllustrationLayer
    /** The background, which moves as the story does. */
    backdrop: Backdrop | null
    /** Where a run begins. Each entrance starts a fresh run from here. */
    start: Run
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** Leave the story for the splash screen. */
    onHome: () => void
    /** Called with the run each time it reaches a new screen. */
    onProgress?: (run: Run) => void
    /** The black the ending fades the display to. */
    curtain: Curtain
  }
  const {
    engine,
    region,
    illustrations,
    backdrop,
    start,
    active,
    onHome,
    onProgress,
    curtain,
  }: Props = $props()

  // The progress row is drawn by the engine, on the region's anchor so that its
  // coordinates are the layout's.
  /* svelte-ignore state_referenced_locally */
  const trail = new TrailView(engine)
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(trail)
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
    reveal: 0,
    sign: 1,
  })

  /** What decides how the parts of the screen for `target` arrive. */
  function specOf(target: Run): StagingSpec {
    const at = target.current
    return {
      pace: at.pace ?? 'together',
      hold: at.hold ?? 0,
      hasLabel: !!at.label,
      replies: target.reply().length,
      paragraphs:
        target.text().length + (at.kind === 'ending' && at.title ? 1 : 0),
      hasPrompt: at.kind === 'choice' && !!at.prompt,
    }
  }

  /* svelte-ignore state_referenced_locally */
  const director = new StoryDirector({
    engine,
    motion,
    trail,
    rows: () => rows,
    trailOrigin: () => ({ x: layout.rowX, y: layout.trailY }),
    rowWidth: () => layout.rowWidth,
    stacked: () => layout.stacked,
    plan: (target) => {
      const staging = stagingFor(specOf(target))
      return {
        textEnd: staging.textEnd,
        hold: staging.hold,
        cut: !!target.current.cut,
      }
    },
    curtain,
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
  const reply = $derived(run.reply())
  const staging = $derived(stagingFor(specOf(run)))
  const title = $derived(node.kind === 'ending' ? node.title : undefined)
  // Where each part sits in the schedule: the label, the reply, the title, the
  // paragraphs and the prompt, in that order.
  const replyAt = $derived(node.label ? 1 : 0)
  const titleAt = $derived(replyAt + reply.length)
  const paragraphAt = $derived(titleAt + (title ? 1 : 0))
  const promptAt = $derived(paragraphAt + paragraphs.length)
  const shown = (index: number): number =>
    pieceAlpha(staging, index, motion.reveal)

  const screenKind = $derived<ScreenKind>(
    node.kind === 'choice' ? 'choice' : node.illustration ? 'picture' : 'text',
  )
  // The window's width in CSS pixels, which sets the size of the text.
  const cssWidth = $derived(region.rect.width / region.cssPxInWorld)
  const answerSize = $derived(
    bodyCssPx(cssWidth) * ANSWER_SHARE * region.cssPxInWorld,
  )
  const layout = $derived(
    layoutIn(region, screenKind, {
      answers:
        node.kind === 'choice'
          ? node.options.map((o) => o.label.length)
          : undefined,
      answerSize,
      // Once the story has begun, the answers go under the text.
      choices: run.narrated ? 'below' : 'side',
    }),
  )
  // The squares take the colors of the mood the screen arrives in, not those of
  // a blend that is still playing.
  const look = $derived(moodNamed(run.mood))
  const answerMinHeight = $derived(tapHeight(TILE_SIZE, region.cssPxInWorld))

  // The text takes the largest size at which the box holds it, and a screen
  // with only a few words is set larger.
  let textBox = $state<HTMLElement | null>(null)
  /** How far the text and the answers rise, in design pixels. */
  let lift = $state(0)
  function fit(): void {
    if (!textBox) return
    const characters =
      paragraphs.join('').length +
      reply.join('').length +
      (title?.length ?? 0) +
      (node.label?.length ?? 0)
    const { min, max } = textRange(
      characters,
      region.cssPxInWorld,
      cssWidth,
      screenKind === 'text',
    )
    fitText(textBox, min, max)
    // With the answers under it, the text sits at the bottom of its box. Both
    // then move up by half of what the text leaves free, so the two stay
    // together in the middle of the screen however short the text is.
    lift = layout.answersBelow
      ? Math.max(0, textBox.clientHeight - contentHeight(textBox)) / 2
      : 0
  }
  $effect(() => {
    void paragraphs
    void reply
    void node
    void layout.text.width
    void layout.text.height
    void region.cssPxInWorld
    void cssWidth
    if (!textBox) return
    void tick().then(fit)
  })
  onMount(() => {
    document.fonts?.addEventListener('loadingdone', fit)
    return () => document.fonts?.removeEventListener('loadingdone', fit)
  })
  // The picture goes in the media box, wherever the window puts it.
  $effect(() => {
    illustrations.place(inWorld(layout.media, region.rect))
  })

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

  // Every screen the visitor reaches is reported, so a reload can carry on.
  $effect(() => {
    if (active) onProgress?.(run)
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

  onDestroy(() => {
    director.destroy()
    trail.destroy()
  })

  function pick(optionId: string): void {
    if (node.kind !== 'choice') return
    const index = node.options.findIndex((o) => o.id === optionId)
    void transition(() =>
      director.forward(run.choose(optionId), { index, id: optionId }),
    )
  }

  function forward(): void {
    void transition(() => director.forward(run.continue(), null))
  }

  /** A screen's button that fades to black and cuts to the next screen. */
  function fadeThrough(): void {
    void transition(() => director.fadeThrough(run.continue()))
  }

  /** The last screen's button: the display fades to black, then starts over. */
  function finish(): void {
    void transition(async () => {
      await director.finish()
      onHome()
    })
  }

  /**
   * The text column moves as one unit, the title and paragraphs together. It is
   * styled with `style:` directives, because a `style` attribute would erase
   * the font size `fitText` sets on the box each time the motion changed it.
   */
  const textSlide = $derived(
    `translateX(${slideOffset(motion.sign, motion.text, MOTION.slideDistance)}px)`,
  )

  const navSlide = $derived(
    `translateX(${slideOffset(motion.sign, motion.nav, MOTION.navDistance)}px)`,
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
  style:--row-x="{layout.rowX}px"
  style:--row-width="{layout.rowWidth}px"
  style:--text-x="{layout.text.x}px"
  style:--text-y="{layout.text.y - lift}px"
  style:--text-width="{layout.text.width}px"
  style:--text-height="{layout.text.height}px"
  style:--media-x="{layout.media.x}px"
  style:--media-y="{layout.media.y}px"
  style:--media-width="{layout.media.width}px"
  style:--media-height="{layout.media.height}px"
  style:--nav-y="{layout.navY}px"
  style:--nav-height="{layout.navHeight}px"
>
  <!-- The engine draws the progress row. This is its name for screen readers. -->
  <span
    class="story__trail-label"
    role="img"
    aria-label={$t.story.progressLabel(run.progress().length)}
  ></span>

  <div
    class="story__text"
    class:story__text--stacked={layout.stacked}
    class:story__text--centered={layout.centered}
    class:story__text--below={layout.answersBelow}
    style:opacity={motion.text}
    style:transform={textSlide}
    bind:this={textBox}
  >
    {#if node.label}
      <p class="story__label" style:opacity={shown(0)}>{node.label}</p>
    {/if}
    {#each reply as line, i (i)}
      <p class="story__reply" style:opacity={shown(replyAt + i)}>
        {line}
      </p>
    {/each}
    {#if title}
      <h1 class="story__title" style:opacity={shown(titleAt)}>
        {title}
      </h1>
    {/if}
    {#each paragraphs as paragraph, i (i)}
      <p class="story__paragraph" style:opacity={shown(paragraphAt + i)}>
        {paragraph}
      </p>
    {/each}
    {#if node.kind === 'choice' && node.prompt}
      <p class="story__prompt" style:opacity={shown(promptAt)}>
        {node.prompt}
      </p>
    {/if}
    {#if node.kind !== 'choice'}
      <div
        class="story__nav"
        style:opacity={motion.nav}
        style:transform={navSlide}
        style:--answer-size="{answerSize}px"
        style:--nav-justify={layout.centered ? 'center' : 'flex-start'}
      >
        <NavBar
          disabled={busy || !active}
          forward={node.kind === 'scene' || node.kind === 'moment'
            ? {
                label: node.button ?? $t.story.continue,
                onPress: node.fadeOut ? fadeThrough : forward,
                style: node.buttonStyle,
              }
            : node.kind === 'ending'
              ? {
                  label: node.button ?? $t.story.startOver,
                  onPress: node.fadeOut ? finish : onHome,
                  style: node.buttonStyle,
                }
              : undefined}
        />
      </div>
    {/if}
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
</section>

<!-- A sibling of the section, not inside it: the answers' text anchors to the
     engine's rows, and an anchored element cannot sit in another one. -->
{#if node.kind === 'choice'}
  {#key run.currentId}
    <ChoiceStage
      {engine}
      {region}
      box={{ ...layout.answers, y: layout.answers.y - lift }}
      options={node.options}
      {picked}
      disabled={busy || !active}
      ariaLabel={$t.story.optionLabel}
      minHeight={answerMinHeight}
      fontSize={answerSize}
      horizontal={layout.answersRow}
      centered={layout.centered}
      colors={{ base: look.text, pick: look.action }}
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

  .story__text
    position: absolute
    inset-inline-start: var(--text-x)
    inset-block-start: var(--text-y)
    display: flex
    flex-direction: column
    // Text taller than its box starts at the top and scrolls.
    justify-content: safe center
    box-sizing: border-box
    width: var(--text-width)
    height: var(--text-height)
    min-width: 0
    // Safari leaves a faded or moved box half painted unless it has a layer.
    will-change: opacity, transform
    font-size: var(--text-size, 44px)
    gap: 1.5em

  // On a portrait screen the text can be longer than the room it has, and the
  // anchor container ignores pointers, so the box takes them for scrolling.
  .story__text--stacked
    overflow-y: auto
    overscroll-behavior: contain
    pointer-events: auto
    scrollbar-width: none

  // With the answers under it the text sits against them.
  .story__text--below
    justify-content: safe flex-end

  .story__text--centered
    text-align: center

  .story__paragraph,
  .story__reply
    @include type.body
    font-size: 1em
    margin: 0

  // One empty line between paragraphs, as in the design. The text boxes are
  // trimmed to cap height and baseline, so the gap is two lines less a cap.
  // What came back for the answer is set like the text, and runs into it.
  .story__paragraph + .story__paragraph,
  .story__reply + .story__reply,
  .story__reply + .story__paragraph
    margin-block-start: calc(1.8em - 1cap - 1.3em)

  // The time marker at the top of a chapter's first screen.
  .story__label
    @include type.trimmed
    margin: 0
    color: var(--color-accent)
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: 1.15em
    line-height: 1
    letter-spacing: 0.02em
    text-transform: uppercase

  .story__prompt
    @include type.body
    font-size: 0.8em
    margin: 0.4em 0 0
    color: var(--color-accent)

  .story__title
    @include type.letter
    font-size: 2.2em
    margin: 0

  .story__side
    position: absolute
    inset-inline-start: var(--media-x)
    inset-block-start: var(--media-y)
    width: var(--media-width)
    height: var(--media-height)

  .story__illustration
    width: 100%
    height: 100%

  // The way forward comes after the text, in the same column.
  .story__nav
    margin-block-start: 0.4em
</style>
