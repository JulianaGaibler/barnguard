<!--
  Keeps the background's spots in the corners of the visible area. It draws
  nothing itself: the region's rect changes with the window, and the background
  is an engine layer, so something inside the UI layer has to carry the change.
-->
<script lang="ts">
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import type { Background } from './backgroundLayer'

  interface Props {
    region: UiRegion
    background: Background
  }
  const { region, background }: Props = $props()

  $effect(() => {
    background.fit(region.rect)
  })
</script>
