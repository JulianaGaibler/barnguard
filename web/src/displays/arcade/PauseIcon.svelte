<!--
  The pause mark as an icon component, for a screen-space DOM button.

  Same proportions as the canvas `drawPauseGlyph`, so a game that has to put its
  pause control in the DOM still reads as the same control as the games that draw
  it on the canvas. A game whose camera pans or zooms needs the DOM version:
  canvas chrome placed in world units drifts and scales with the view.
-->
<script lang="ts">
  interface Props {
    /**
     * Any CSS length. Prefer `rem` on booth chrome: the root size is fluid and
     * the attendant scales the whole UI with `--ui-scale`, so a px icon stops
     * matching the button around it.
     */
    size?: string
  }
  const { size = '1.5rem' }: Props = $props()

  // Fractions lifted from `games/common/pauseGlyph.ts`, scaled to a 24 box so
  // the two stay recognisably the same mark.
  const BAR_W = 24 * 0.11
  const BAR_H = 24 * 0.36
  const GAP = 24 * 0.1
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <rect
    x={12 - GAP / 2 - BAR_W}
    y={12 - BAR_H / 2}
    width={BAR_W}
    height={BAR_H}
    rx={BAR_W * 0.4}
  />
  <rect
    x={12 + GAP / 2}
    y={12 - BAR_H / 2}
    width={BAR_W}
    height={BAR_H}
    rx={BAR_W * 0.4}
  />
</svg>
