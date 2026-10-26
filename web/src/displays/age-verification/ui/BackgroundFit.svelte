<!--
  Keeps the engine layers matched to the window. It draws nothing itself: the
  region's rect and scale change with the window, and the layers are engine
  nodes, so something inside the UI layer has to carry the change. The
  background's spots stay in the corners of the visible area, and the dither
  cells keep their size on screen, a little smaller on a narrow window.
-->
<script lang="ts">
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import type { Background } from './backgroundLayer'
  import type { IllustrationLayer } from './IllustrationLayer'

  interface Props {
    region: UiRegion
    background: Background
    illustrations: IllustrationLayer
  }
  const { region, background, illustrations }: Props = $props()

  $effect(() => {
    background.fit(region.rect)
  })

  $effect(() => {
    const scale = region.cssPxInWorld
    const cssWidth = region.rect.width / scale
    for (const fixed of background.cells) fixed.apply(scale, cssWidth)
    illustrations.setScale(scale)
  })
</script>
