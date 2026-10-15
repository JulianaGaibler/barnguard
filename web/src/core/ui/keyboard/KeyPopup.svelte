<!--
  The two pop-ups above a held key: a preview bubble for each pressed letter,
  and the accent strip. Both are placed with `transform` from CSS variables, so
  a pointer move never changes layout. Positions are in px relative to the
  keyboard, which the parent positions this inside.
-->
<script lang="ts">
  export interface Bubble {
    id: string
    char: string
    /** Horizontal center of the key. */
    x: number
    /** Top of the key. The bubble sits above it. */
    y: number
  }

  export interface Strip {
    x: number
    y: number
    width: number
    height: number
    cellWidth: number
    gap: number
    /** Cells in visual order, left to right. */
    cells: { char: string; highlighted: boolean }[]
  }

  interface Props {
    bubbles: readonly Bubble[]
    strip: Strip | null
  }
  const { bubbles, strip }: Props = $props()
</script>

{#each bubbles as bubble (bubble.id)}
  <div class="bubble" style="--x: {bubble.x}px; --y: {bubble.y}px">
    {bubble.char}
  </div>
{/each}

{#if strip}
  <div
    class="strip"
    style="--x: {strip.x}px; --y: {strip.y}px; width: calc({strip.width}px + 2 * var(--strip-padding)); height: calc({strip.height}px + 2 * var(--strip-padding)); gap: {strip.gap}px"
  >
    {#each strip.cells as cell (cell.char)}
      <div
        class="cell"
        class:highlighted={cell.highlighted}
        style:width="{strip.cellWidth}px"
      >
        {cell.char}
      </div>
    {/each}
  </div>
{/if}

<style lang="sass">
  .bubble,
  .strip
    position: absolute
    left: 0
    top: 0
    z-index: 1
    pointer-events: none
    will-change: transform

  .bubble
    display: flex
    align-items: center
    justify-content: center
    width: var(--space-64)
    height: var(--space-64)
    transform: translate(var(--x), var(--y)) translate(-50%, -100%)
    border-radius: var(--radius-card)
    background: var(--color-surface-card)
    box-shadow: var(--color-shadow-card)
    color: var(--color-text)
    font-size: 1.75rem
    font-weight: 800

  // Solid, so the keys and suggestions it covers do not show between cells. The
  // padding grows the panel outward, so the cells stay where the geometry puts
  // them.
  .strip
    --strip-padding: var(--space-4)
    box-sizing: border-box
    display: flex
    padding: var(--strip-padding)
    transform: translate(calc(var(--x) - var(--strip-padding)), calc(var(--y) - var(--strip-padding)))
    border-radius: calc(var(--radius-card) + var(--strip-padding))
    background: var(--color-surface-card)
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-text) 12%, transparent), var(--color-shadow-card)

  .cell
    display: flex
    align-items: center
    justify-content: center
    flex-shrink: 0
    border-radius: var(--radius-card)
    background: var(--color-surface-card)
    color: var(--color-text)
    font-size: 1.5rem
    font-weight: 800

    &.highlighted
      background: var(--color-text)
      color: var(--color-input-bg)
</style>
