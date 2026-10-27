<!--
  A folder lying on the desk: a tab with a title, and the page under it. The
  tab's corner steps down like the brand's pixel shapes. It is only a shape.
  Whoever places it handles its entrance, its taps and any turn.

  The tab and the page are one SVG path, so there is no seam between them and
  the edges stay smooth when the folder is turned. The path is drawn in pixels
  from the measured sizes, so the step keeps its shape at any size.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** What the tab says. Without one the folder has no tab. */
    title?: string
    /** The folder's color. */
    color: string
    children?: Snippet
  }
  const { title, color, children }: Props = $props()

  let width = $state(0)
  let height = $state(0)
  let tabWidth = $state(0)
  let tabHeight = $state(0)

  // The step cut out of the tab's top right corner, in proportion to the tab.
  const outline = $derived.by(() => {
    if (!title || tabHeight === 0) return `M0 0H${width}V${height}H0Z`
    const stepX = tabHeight * 0.6
    const stepY = tabHeight * 0.3
    return (
      `M0 0H${tabWidth - stepX}V${stepY}H${tabWidth}V${tabHeight}` +
      `H${width}V${height}H0Z`
    )
  })
</script>

<div class="folder" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    class="folder__shape"
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    aria-hidden="true"
  >
    <path d={outline} fill={color} />
  </svg>
  {#if title}
    <div
      class="folder__tab"
      bind:clientWidth={tabWidth}
      bind:clientHeight={tabHeight}
    >
      <span>{title}</span>
    </div>
  {/if}
  <div class="folder__page">{@render children?.()}</div>
</div>

<style lang="sass">
  @use './type'

  .folder
    position: relative
    height: 100%
    display: flex
    flex-direction: column
    color: var(--color-text)

  .folder__shape
    position: absolute
    inset: 0
    pointer-events: none

  // The tab sits on the left. Its color comes from the shape behind.
  .folder__tab
    position: relative
    align-self: flex-start
    max-width: 85%
    padding: 0.45em 1.6em 0.25em 0.9em

    span
      @include type.letter
      display: block
      font-size: 1.15em
      line-height: 1

  .folder__page
    position: relative
    flex: 1
    padding: 0.8em 1em 1em
</style>
