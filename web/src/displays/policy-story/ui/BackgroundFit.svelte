<!--
  Keeps the engine layers matched to the window. It draws nothing itself: the
  region's rect and scale change with the window, and the layers are engine
  nodes, so something inside the UI layer has to carry the change. The
  background's spots stay in the corners of the visible area, and the dither
  cells keep their size on screen.
-->
<script lang="ts">
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import type { Background } from './backgroundLayer'
  import type { FixedCells } from './ditherLook'
  import type { IllustrationLayer } from './IllustrationLayer'

  interface Props {
    region: UiRegion
    background: Background
    illustrations: IllustrationLayer
    /** Dithers of other layers that keep their cell size on screen. */
    cells?: readonly FixedCells[]
  }
  const { region, background, illustrations, cells = [] }: Props = $props()

  $effect(() => {
    background.fit(region.rect)
  })

  $effect(() => {
    const scale = region.cssPxInWorld
    const cssWidth = region.rect.width / scale
    for (const fixed of background.cells) fixed.apply(scale, cssWidth)
    for (const fixed of cells) fixed.apply(scale)
    illustrations.setScale(scale)
  })
</script>
